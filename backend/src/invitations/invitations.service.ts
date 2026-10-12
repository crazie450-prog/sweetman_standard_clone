import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import * as argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { MailerService } from '../mailer/mailer.service'
import { assertReaches, outsideTenant, requireTenant } from '../tenancy/tenant-context'
import { lockKey, serialized } from '../common/utils/serialize'
import { roleBelow } from '../common/decorators/roles.decorator'
import type { Role } from '../generated/prisma/client'
import { assertLocationsActive } from '../rules/locations'
import { assertReferencesOwned } from '../tenancy/references'

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  private assertBelow(role: Role) {
    if (!roleBelow(role, requireTenant().role)) {
      throw new ForbiddenException({
        code: 'INVITE_ROLE_TOO_HIGH',
        message: 'Inviting is only for roles below your own',
      })
    }
  }

  private assertOwn(inv: { role: Role; locationIds: unknown }) {
    this.assertBelow(inv.role)
    const ids = Array.isArray(inv.locationIds)
      ? inv.locationIds.filter((v): v is string => typeof v === 'string')
      : []
    assertReaches(ids)
  }

  async list() {
    return this.prisma.client.invitation.findMany({
      where: { status: 'pending' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        invitedBy: { select: { fullName: true } },
      },
    })
  }

  async create(input: { email: string; role: Role; locationIds?: string[] }) {
    const ctx = requireTenant()
    const email = input.email.toLowerCase().trim()
    this.assertBelow(input.role)
    assertReaches(input.locationIds ?? [])

    const locationIds = input.locationIds ?? []
    if (locationIds.length > 0) {
      await assertReferencesOwned(this.prisma.client, { locationId: locationIds })
      await assertLocationsActive(this.prisma.client, locationIds)
    }

    const token = randomBytes(32).toString('hex')
    const invitation = await serialized(
      this.prisma.client,
      lockKey('invitation', ctx.organizationId, email),
      async (tx) => {
        const member = await tx.user.findUnique({ where: { email } })
        if (member && !member.isActive) {
          throw new ConflictException({
            code: 'MEMBER_DEACTIVATED',
            message:
              'This person was deactivated; reactivate them from the Team list instead of inviting them again',
          })
        }
        if (member)
          throw new ConflictException({
            code: 'MEMBER_ALREADY_IN_TEAM',
            message: 'This person is already a member of the team',
          })
        const registered = await outsideTenant(() =>
          tx.user.findUnique({ where: { email }, select: { id: true } }),
        )
        if (registered)
          throw new ConflictException({
            code: 'EMAIL_ALREADY_REGISTERED',
            message: 'This email is already registered',
          })

        const pending = await tx.invitation.findFirst({ where: { email, status: 'pending' } })
        if (pending)
          throw new ConflictException({
            code: 'INVITATION_ALREADY_PENDING',
            message: 'Invitation for this email is already pending',
          })

        return tx.invitation.create({
          data: {
            organizationId: ctx.organizationId,
            email,
            role: input.role,
            token,
            locationIds,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
            invitedById: ctx.userId,
          },
        })
      },
    )

    const org = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { name: true },
    })
    const inviter = await this.prisma.client.user.findUnique({
      where: { id: ctx.userId },
      select: { fullName: true },
    })
    const emailDelivered = await this.mailer.sendInvitation(
      email,
      {
        organization: org.name,
        role: invitation.role,
        invitedBy: inviter?.fullName ?? null,
        expiresAt: invitation.expiresAt,
      },
      token,
    )

    return {
      id: invitation.id,
      email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      emailDelivered,
      acceptUrl: emailDelivered ? null : this.mailer.invitationUrl(token),
    }
  }

  async resend(id: string) {
    const inv = await this.prisma.client.invitation.findUnique({ where: { id } })
    if (!inv || inv.status !== 'pending')
      throw new NotFoundException({ code: 'INVITATION_NOT_FOUND', message: 'Invitation not found' })
    this.assertOwn(inv)

    const token = randomBytes(32).toString('hex')
    const { count } = await this.prisma.client.invitation.updateMany({
      where: { id, status: 'pending' },
      data: { token, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
    })
    if (count === 0)
      throw new NotFoundException({ code: 'INVITATION_NOT_FOUND', message: 'Invitation not found' })
    const updated = await this.prisma.client.invitation.findUniqueOrThrow({ where: { id } })

    const org = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: inv.organizationId },
      select: { name: true },
    })
    const inviter = inv.invitedById
      ? await this.prisma.client.user.findUnique({
          where: { id: inv.invitedById },
          select: { fullName: true },
        })
      : null
    const emailDelivered = await this.mailer.sendInvitation(
      inv.email,
      {
        organization: org.name,
        role: updated.role,
        invitedBy: inviter?.fullName ?? null,
        expiresAt: updated.expiresAt,
      },
      token,
    )

    return {
      id: updated.id,
      email: updated.email,
      expiresAt: updated.expiresAt,
      emailDelivered,
      acceptUrl: emailDelivered ? null : this.mailer.invitationUrl(token),
    }
  }

  async revoke(id: string) {
    const inv = await this.prisma.client.invitation.findUnique({ where: { id } })
    if (!inv || inv.status !== 'pending')
      throw new NotFoundException({ code: 'INVITATION_NOT_FOUND', message: 'Invitation not found' })
    this.assertOwn(inv)
    const { count } = await this.prisma.client.invitation.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'revoked' },
    })
    if (count === 0)
      throw new NotFoundException({ code: 'INVITATION_NOT_FOUND', message: 'Invitation not found' })
    return { ok: true }
  }

  async preview(token: string) {
    const invitation = await this.prisma.client.invitation.findUnique({
      where: { token },
      select: {
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        organization: { select: { name: true } },
      },
    })
    if (!invitation || invitation.status !== 'pending') {
      throw new NotFoundException({ code: 'INVITATION_INVALID', message: 'Invitation is invalid' })
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException({
        code: 'INVITATION_EXPIRED',
        message: 'Invitation has expired',
      })
    }
    return {
      email: invitation.email,
      role: invitation.role,
      organizationName: invitation.organization.name,
      expiresAt: invitation.expiresAt.toISOString(),
    }
  }

  async accept(token: string, input: { fullName: string; password: string }) {
    const invitation = await this.prisma.client.invitation.findUnique({ where: { token } })
    if (!invitation || invitation.status !== 'pending') {
      throw new NotFoundException({ code: 'INVITATION_INVALID', message: 'Invitation is invalid' })
    }
    if (invitation.expiresAt < new Date()) {
      await this.prisma.client.invitation.update({
        where: { id: invitation.id },
        data: { status: 'expired' },
      })
      throw new BadRequestException({
        code: 'INVITATION_EXPIRED',
        message: 'Invitation has expired',
      })
    }
    const existing = await this.prisma.client.user.findUnique({
      where: { email: invitation.email },
    })
    if (existing)
      throw new ConflictException({ code: 'USER_ALREADY_EXISTS', message: 'User already exists' })

    const offered = (invitation.locationIds as string[]) ?? []
    const locationIds =
      offered.length === 0
        ? []
        : (
            await this.prisma.client.location.findMany({
              where: {
                id: { in: offered },
                organizationId: invitation.organizationId,
                isActive: true,
              },
              select: { id: true },
            })
          ).map((l) => l.id)
    if (offered.length > 0 && locationIds.length === 0) {
      throw new BadRequestException({
        code: 'INVITATION_LOCATIONS_ARCHIVED',
        message:
          'Every location this invitation offered has been archived since; ask for a new invitation',
      })
    }
    const hashed = await argon2.hash(input.password)

    const user = await this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, token, status: 'pending' },
        data: { status: 'accepted', acceptedAt: new Date() },
      })
      if (claimed.count === 0) {
        throw new NotFoundException({
          code: 'INVITATION_INVALID',
          message: 'Invitation is invalid',
        })
      }
      const created = await tx.user.create({
        data: {
          organizationId: invitation.organizationId,
          email: invitation.email,
          hashedPassword: hashed,
          fullName: input.fullName,
          role: invitation.role,
          emailVerified: true,
        },
      })
      if (locationIds.length > 0) {
        await tx.userLocation.createMany({
          data: locationIds.map((locationId) => ({ userId: created.id, locationId })),
        })
      }
      return created
    })

    return user
  }
}
