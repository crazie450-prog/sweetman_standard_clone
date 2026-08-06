import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService, JwtSignOptions } from '@nestjs/jwt'
import * as argon2 from 'argon2'
import { createHash, randomBytes } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { MailerService } from '../mailer/mailer.service'
import type { AccessTokenPayload } from '../tenancy/tenant.middleware'
import type { Role, User } from '../generated/prisma/client'

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000

export interface TokenPair {
  accessToken: string
  refreshToken: string
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
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mailer: MailerService,
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

    const existing = await this.prisma.client.user.findUnique({ where: { email } })
    if (existing) throw new ConflictException('Email already registered')

    const slugBase = input.organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48)

    const hashed = await argon2.hash(input.password)

    const user = await this.prisma.client.$transaction(async (tx) => {
      let slug = slugBase || 'org'
      if (await tx.organization.findUnique({ where: { slug } })) {
        slug = `${slug}-${randomBytes(3).toString('hex')}`
      }
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
    const generic = new UnauthorizedException('Invalid email or password')
    if (!user || !user.isActive) throw generic

    const lockoutExpired = Boolean(user.lockoutUntil && user.lockoutUntil <= new Date())
    if (user.lockoutUntil && !lockoutExpired) {
      throw new HttpException(
        'Account temporarily locked after failed attempts. Try again later.',
        HttpStatus.LOCKED,
      )
    }

    const ok = await argon2.verify(user.hashedPassword, password)
    if (!ok) {
      const attempts = (lockoutExpired ? 0 : user.failedLoginAttempts) + 1
      await this.prisma.client.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          lockoutUntil:
            attempts >= MAX_FAILED_ATTEMPTS
              ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
              : null,
        },
      })
      throw generic
    }

    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockoutUntil: null, lastLoginAt: new Date() },
    })

    const tokens = await this.issueTokens(user, userAgent)
    return { user, tokens }
  }

  // --------------------------------------------------------------- refresh
  async refresh(refreshToken: string, userAgent?: string): Promise<TokenPair> {
    const invalid = new UnauthorizedException('Invalid refresh token')
    let payload: AccessTokenPayload
    try {
      payload = this.jwt.verify<AccessTokenPayload>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      })
    } catch {
      throw invalid
    }

    const user = await this.prisma.client.user.findUnique({ where: { id: payload.sub } })
    if (!user || !user.isActive) throw invalid

    const presented = this.hashToken(refreshToken)
    const session = await this.prisma.client.userSession.findFirst({
      where: { OR: [{ refreshTokenHash: presented }, { previousTokenHash: presented }] },
    })
    if (!session || session.userId !== user.id) throw invalid

    const reused = session.previousTokenHash === presented
    if (reused || session.expiresAt <= new Date()) {
      await this.prisma.client.userSession.delete({ where: { id: session.id } })
      throw invalid
    }

    return this.issueTokens(user, userAgent ?? session.userAgent ?? undefined, session.id)
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
        locationAccess: { include: { location: { select: { id: true, name: true } } } },
      },
    })
    const locations =
      user.locationAccess.length > 0
        ? user.locationAccess.map((a) => a.location)
        : await this.prisma.client.location.findMany({
            where: { organizationId: user.organizationId, isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
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
    }
  }

  async updateProfile(userId: string, input: { fullName?: string; email?: string }) {
    const email = input.email?.toLowerCase().trim()
    if (email) {
      const taken = await this.prisma.client.user.findUnique({ where: { email } })
      if (taken && taken.id !== userId) {
        throw new ConflictException('Email is already in use')
      }
    }
    await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
        ...(email === undefined ? {} : { email, emailVerified: false }),
      },
    })
    return this.me(userId)
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } })
    const ok = await argon2.verify(user.hashedPassword, currentPassword)
    if (!ok) throw new UnauthorizedException('Current password is incorrect')

    await this.prisma.client.user.update({
      where: { id: userId },
      data: { hashedPassword: await argon2.hash(newPassword) },
    })
    await this.endAllSessions(userId)
    return { ok: true }
  }

  // ------------------------------------------------------ forgot / reset
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.client.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    })
    if (!user || !user.isActive) return

    const token = randomBytes(32).toString('hex')
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: this.hashToken(token),
        passwordResetExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    })
    await this.mailer.sendPasswordReset(user.email, token)
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const user = await this.prisma.client.user.findFirst({
      where: {
        passwordResetToken: this.hashToken(token),
        passwordResetExpires: { gt: new Date() },
      },
    })
    if (!user) throw new UnauthorizedException('Reset link is invalid or expired')

    await this.prisma.client.user.update({
      where: { id: user.id },
      data: {
        hashedPassword: await argon2.hash(password),
        passwordResetToken: null,
        passwordResetExpires: null,
        failedLoginAttempts: 0,
        lockoutUntil: null,
      },
    })
    await this.endAllSessions(user.id)
  }

  // ---------------------------------------------------------------- helpers
  private async issueTokens(
    user: User,
    userAgent?: string,
    sessionId?: string,
  ): Promise<TokenPair> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      org: user.organizationId,
      role: user.role,
      ...(user.isPlatformAdmin ? { pa: true } : {}),
    }
    const ttl = (v: string): JwtSignOptions['expiresIn'] => v as JwtSignOptions['expiresIn']
    const accessToken = this.jwt.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: ttl(process.env.JWT_ACCESS_TTL ?? '15m'),
    })
    const refreshToken = this.jwt.sign(
      { ...payload, jti: randomBytes(8).toString('hex') },
      {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: ttl(process.env.JWT_REFRESH_TTL ?? '7d'),
      },
    )

    const refreshTokenHash = this.hashToken(refreshToken)
    const expiresAt = this.expiryOf(refreshToken)
    const trimmedAgent = userAgent?.slice(0, 200)

    if (sessionId) {
      const current = await this.prisma.client.userSession.findUnique({ where: { id: sessionId } })
      await this.prisma.client.userSession.update({
        where: { id: sessionId },
        data: {
          refreshTokenHash,
          previousTokenHash: current?.refreshTokenHash ?? null,
          expiresAt,
          lastUsedAt: new Date(),
          userAgent: trimmedAgent,
        },
      })
    } else {
      await this.prisma.client.userSession.deleteMany({
        where: { userId: user.id, expiresAt: { lte: new Date() } },
      })
      await this.prisma.client.userSession.create({
        data: { userId: user.id, refreshTokenHash, expiresAt, userAgent: trimmedAgent },
      })
    }
    return { accessToken, refreshToken }
  }

  private expiryOf(token: string): Date {
    const { exp } = this.jwt.decode<{ exp?: number }>(token) ?? {}
    return exp ? new Date(exp * 1000) : new Date(Date.now() + 7 * 24 * 3600 * 1000)
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}
