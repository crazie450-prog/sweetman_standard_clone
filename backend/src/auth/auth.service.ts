import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService, JwtSignOptions } from '@nestjs/jwt'
import * as argon2 from 'argon2'
import { createHash, randomBytes } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { MailerService } from '../mailer/mailer.service'
import type { AppConfig } from '../config/env.validation'
import type { AccessTokenPayload } from '../tenancy/tenant.middleware'
import type { Role, User } from '../generated/prisma/client'
import { locationOrder, throughLocationOrder } from '../rules/locations'
import { duplicateColumns } from '../common/utils/duplicate'
import type { Serial } from '../common/utils/serialize'

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000
const ROTATION_GRACE_MS = 30_000
const SLUG_ATTEMPTS = 5

const lifetime = (value: string) => value as JwtSignOptions['expiresIn']

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

export interface Refreshed {
  accessToken: string
  refreshToken: string | null
}

export interface AuthedUser {
  id: string
  email: string
  fullName: string
  role: Role
  organizationId: string
  organizationName: string
  isPlatformAdmin: boolean
  locations: { id: string; name: string }[]
  assigned: boolean
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mailer: MailerService,
    @Inject(ConfigService) private readonly config: AppConfig,
  ) {}

  // -------------------------------------------------------------- register
  async register(
    input: {
      organizationName: string
      fullName: string
      email: string
      password: string
    },
    userAgent?: string,
  ): Promise<{ user: User; tokens: TokenPair }> {
    const email = input.email.toLowerCase().trim()

    const taken = () =>
      new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'Email already registered',
      })
    if (await this.prisma.client.user.findUnique({ where: { email } })) throw taken()

    const slugBase =
      input.organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'org'

    const hashed = await argon2.hash(input.password)

    const open = (slug: string) =>
      this.prisma.client.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: input.organizationName,
            slug,
            ownerName: input.fullName,
            ownerEmail: email,
            trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
          },
        })
        await tx.location.create({
          data: { organizationId: org.id, name: 'Main', isDefault: true },
        })
        return tx.user.create({
          data: {
            organizationId: org.id,
            email,
            hashedPassword: hashed,
            fullName: input.fullName,
            role: 'owner',
            emailVerified: false,
          },
        })
      })

    let user: User | undefined
    for (let attempt = 0; !user; attempt++) {
      const slug = attempt === 0 ? slugBase : `${slugBase}-${randomBytes(3).toString('hex')}`
      try {
        user = await open(slug)
      } catch (e) {
        const columns = duplicateColumns(e)
        if (columns?.some((c) => c === 'email' || c === 'ownerEmail')) throw taken()
        if (!columns?.includes('slug') || attempt >= SLUG_ATTEMPTS) throw e
      }
    }

    const tokens = await this.issueTokens(user, userAgent)
    return { user, tokens }
  }

  // ----------------------------------------------------------------- login
  async login(
    email: string,
    password: string,
    userAgent?: string,
  ): Promise<{ user: User; tokens: TokenPair }> {
    const user = await this.prisma.client.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    })
    const generic = new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    })
    if (!user || !user.isActive) {
      await argon2.verify(await this.stranger(), password).catch(() => false)
      throw generic
    }

    if (!(await this.knownPassword(user, password))) throw generic

    await this.assertOrganizationActive(user.organizationId)

    const tokens = await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: user.id, hashedPassword: user.hashedPassword, isActive: true },
        data: { failedLoginAttempts: 0, lockoutUntil: null, lastLoginAt: new Date() },
      })
      if (count === 0) throw generic
      return this.issueTokens(user, userAgent, tx)
    })
    return { user, tokens }
  }

  private async assertOrganizationActive(organizationId: string): Promise<void> {
    const org = await this.prisma.client.organization.findUnique({
      where: { id: organizationId },
      select: { isActive: true },
    })
    if (!org?.isActive) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_DEACTIVATED',
        message: 'This organization has been deactivated; contact Nexus support to restore access',
      })
    }
  }

  // --------------------------------------------------------------- refresh
  private strangerHash?: Promise<string>

  private stranger(): Promise<string> {
    this.strangerHash ??= argon2.hash(randomBytes(16).toString('hex'))
    return this.strangerHash
  }

  async refresh(refreshToken: string, userAgent?: string): Promise<Refreshed> {
    const invalid = new UnauthorizedException({
      code: 'REFRESH_TOKEN_INVALID',
      message: 'Invalid refresh token',
    })
    let payload: AccessTokenPayload
    try {
      payload = this.jwt.verify<AccessTokenPayload>(refreshToken, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET', { infer: true }),
      })
    } catch {
      throw invalid
    }

    const user = await this.prisma.client.user.findUnique({
      where: { id: payload.sub },
      include: { organization: { select: { isActive: true } } },
    })
    if (!user || !user.isActive || !user.organization.isActive) throw invalid

    const presented = this.hashToken(refreshToken)
    const session = await this.prisma.client.userSession.findFirst({
      where: { OR: [{ refreshTokenHash: presented }, { previousTokenHash: presented }] },
    })
    if (!session || session.userId !== user.id) throw invalid

    const now = Date.now()
    const reused = session.previousTokenHash === presented
    const justRotated = reused && now - session.lastUsedAt.getTime() <= ROTATION_GRACE_MS
    if (session.expiresAt.getTime() <= now || (reused && !justRotated)) {
      await this.prisma.client.userSession.deleteMany({ where: { id: session.id } })
      throw invalid
    }
    if (justRotated) return { accessToken: this.accessTokenFor(user), refreshToken: null }

    const rotated = await this.rotateTokens(user, userAgent ?? session.userAgent ?? undefined, {
      id: session.id,
      presented,
    })
    return rotated ?? { accessToken: this.accessTokenFor(user), refreshToken: null }
  }

  // ---------------------------------------------------------------- logout
  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (!refreshToken) {
      await this.endAllSessions(userId)
      return
    }
    const { count } = await this.prisma.client.userSession.deleteMany({
      where: { userId, refreshTokenHash: this.hashToken(refreshToken) },
    })
    if (count === 0) await this.endAllSessions(userId)
  }

  async endAllSessions(userId: string): Promise<void> {
    await this.prisma.client.userSession.deleteMany({ where: { userId } })
  }

  // -------------------------------------------------------------------- me
  async me(userId: string): Promise<AuthedUser> {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        organization: { select: { name: true } },
        locationAccess: {
          where: { location: { isActive: true } },
          include: { location: { select: { id: true, name: true } } },
          orderBy: throughLocationOrder(),
        },
        _count: { select: { locationAccess: true } },
      },
    })
    const locations =
      user._count.locationAccess > 0
        ? user.locationAccess.map((a) => a.location)
        : await this.prisma.client.location.findMany({
            where: { organizationId: user.organizationId, isActive: true },
            select: { id: true, name: true },
            orderBy: locationOrder(),
          })

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: user.organization.name,
      isPlatformAdmin: user.isPlatformAdmin,
      locations,
      assigned: user._count.locationAccess > 0,
    }
  }

  async updateProfile(
    userId: string,
    input: { fullName?: string; email?: string; currentPassword?: string },
  ) {
    const email = input.email?.toLowerCase().trim()
    let verified: string | null = null
    if (email) {
      const self = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } })
      verified = self.hashedPassword
      if (!(await this.knownPassword(self, input.currentPassword ?? ''))) {
        throw new UnauthorizedException({
          code: 'CURRENT_PASSWORD_INCORRECT',
          message: 'Current password is incorrect',
        })
      }
      const taken = await this.prisma.client.user.findUnique({ where: { email } })
      if (taken && taken.id !== userId) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_IN_USE',
          message: 'Email is already in use',
        })
      }
    }
    await this.prisma.client.$transaction(async (tx) => {
      if (verified !== null) {
        const { count } = await tx.user.updateMany({
          where: { id: userId, hashedPassword: verified },
          data: { failedLoginAttempts: 0 },
        })
        if (count === 0) {
          throw new UnauthorizedException({
            code: 'CURRENT_PASSWORD_INCORRECT',
            message: 'Current password is incorrect',
          })
        }
      }
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
          ...(email === undefined
            ? {}
            : {
                email,
                emailVerified: false,
                passwordResetToken: null,
                passwordResetExpires: null,
                failedLoginAttempts: 0,
                lockoutUntil: null,
              }),
        },
      })
      if (user.role === 'owner' && (email !== undefined || input.fullName !== undefined)) {
        await tx.organization.update({
          where: { id: user.organizationId },
          data: {
            ...(email === undefined ? {} : { ownerEmail: email }),
            ...(input.fullName === undefined ? {} : { ownerName: input.fullName }),
          },
        })
      }
    })
    return this.me(userId)
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    refreshToken?: string,
  ) {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } })
    if (!(await this.knownPassword(user, currentPassword))) {
      throw new UnauthorizedException({
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'Current password is incorrect',
      })
    }

    const hashedPassword = await argon2.hash(newPassword)
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, hashedPassword: user.hashedPassword },
        data: {
          hashedPassword,
          passwordResetToken: null,
          passwordResetExpires: null,
          failedLoginAttempts: 0,
          lockoutUntil: null,
        },
      })
      if (count === 0) {
        throw new UnauthorizedException({
          code: 'CURRENT_PASSWORD_INCORRECT',
          message: 'Current password is incorrect',
        })
      }
      await tx.userSession.deleteMany({
        where: {
          userId,
          ...(refreshToken ? { refreshTokenHash: { not: this.hashToken(refreshToken) } } : {}),
        },
      })
    })
    return { ok: true }
  }

  // ------------------------------------------------------ forgot / reset
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.client.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    })
    if (!user || !user.isActive) return

    const token = await this.issueResetToken(user.id)
    void this.mailer.sendPasswordReset(user.email, token)
  }

  async issueResetToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex')
    await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        passwordResetToken: this.hashToken(token),
        passwordResetExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    })
    return token
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const user = await this.prisma.client.user.findFirst({
      where: {
        passwordResetToken: this.hashToken(token),
        passwordResetExpires: { gt: new Date() },
        isActive: true,
      },
    })
    if (!user)
      throw new UnauthorizedException({
        code: 'RESET_LINK_INVALID',
        message: 'Reset link is invalid or expired',
      })

    const hashedPassword = await argon2.hash(password)
    await this.prisma.client.$transaction(async (tx) => {
      const spent = await tx.user.updateMany({
        where: {
          id: user.id,
          passwordResetToken: this.hashToken(token),
          passwordResetExpires: { gt: new Date() },
        },
        data: {
          hashedPassword,
          passwordResetToken: null,
          passwordResetExpires: null,
          failedLoginAttempts: 0,
          lockoutUntil: null,
        },
      })
      if (spent.count === 0)
        throw new UnauthorizedException({
          code: 'RESET_LINK_INVALID',
          message: 'Reset link is invalid or expired',
        })
      await tx.userSession.deleteMany({ where: { userId: user.id } })
    })
  }

  // ---------------------------------------------------------------- helpers
  private async knownPassword(user: User, password: string): Promise<boolean> {
    const lockoutExpired = Boolean(user.lockoutUntil && user.lockoutUntil <= new Date())
    if (user.lockoutUntil && !lockoutExpired) {
      throw new HttpException(
        {
          code: 'ACCOUNT_LOCKED',
          message: 'Account temporarily locked after failed attempts. Try again later.',
        },
        HttpStatus.LOCKED,
      )
    }
    if (await argon2.verify(user.hashedPassword, password)) return true
    if (lockoutExpired) {
      await this.prisma.client.user.updateMany({
        where: { id: user.id, lockoutUntil: user.lockoutUntil },
        data: { failedLoginAttempts: 0, lockoutUntil: null },
      })
    }
    const counted = await this.prisma.client.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    })
    if (counted.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      await this.prisma.client.user.updateMany({
        where: { id: user.id, lockoutUntil: null },
        data: { lockoutUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) },
      })
    }
    return false
  }

  private payloadOf(user: User): AccessTokenPayload {
    return {
      sub: user.id,
      org: user.organizationId,
      role: user.role,
      ...(user.isPlatformAdmin ? { pa: true } : {}),
    }
  }

  private accessTokenFor(user: User): string {
    return this.jwt.sign(this.payloadOf(user), {
      secret: this.config.getOrThrow('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: lifetime(this.config.getOrThrow('JWT_ACCESS_TTL', { infer: true })),
    })
  }

  private refreshTokenFor(user: User): string {
    return this.jwt.sign(
      { ...this.payloadOf(user), jti: randomBytes(8).toString('hex') },
      {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: lifetime(this.config.getOrThrow('JWT_REFRESH_TTL', { infer: true })),
      },
    )
  }

  private async issueTokens(
    user: User,
    userAgent?: string,
    db: Pick<Serial, 'userSession'> = this.prisma.client,
  ): Promise<TokenPair> {
    const refreshToken = this.refreshTokenFor(user)
    await db.userSession.deleteMany({
      where: { userId: user.id, expiresAt: { lte: new Date() } },
    })
    await db.userSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: this.hashToken(refreshToken),
        expiresAt: this.expiryOf(refreshToken),
        userAgent: userAgent?.slice(0, 200),
      },
    })
    return { accessToken: this.accessTokenFor(user), refreshToken }
  }

  private async rotateTokens(
    user: User,
    userAgent: string | undefined,
    session: { id: string; presented: string },
  ): Promise<TokenPair | null> {
    const refreshToken = this.refreshTokenFor(user)
    const rotated = await this.prisma.client.userSession.updateMany({
      where: { id: session.id, refreshTokenHash: session.presented },
      data: {
        refreshTokenHash: this.hashToken(refreshToken),
        previousTokenHash: session.presented,
        expiresAt: this.expiryOf(refreshToken),
        lastUsedAt: new Date(),
        userAgent: userAgent?.slice(0, 200),
      },
    })
    if (rotated.count === 0) return null
    return { accessToken: this.accessTokenFor(user), refreshToken }
  }

  private expiryOf(token: string): Date {
    const { exp } = this.jwt.decode<{ exp?: number }>(token) ?? {}
    return exp ? new Date(exp * 1000) : new Date(Date.now() + 7 * 24 * 3600 * 1000)
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}
