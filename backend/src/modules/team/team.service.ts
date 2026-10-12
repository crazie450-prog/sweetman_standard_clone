import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { AuthService } from '../../auth/auth.service'
import { MailerService } from '../../mailer/mailer.service'
import { assertReaches, requireTenant } from '../../tenancy/tenant-context'
import { assertLocationsActive, locationOrder, throughLocationOrder } from '../../rules/locations'
import { assertReferencesOwned } from '../../tenancy/references'
import { roleBelow } from '../../common/decorators/roles.decorator'
import type { Role } from '../../generated/prisma/client'
import { UpdateMemberDto } from './dto/team.dto'

function memberContract(u: {
  id: string
  fullName: string
  email: string
  role: string
  isActive: boolean
  locationAccess: { location: { id: string; name: string } }[]
}) {
  return {
    id: u.id,
    name: u.fullName,
    email: u.email,
    role: u.role,
    locations: u.locationAccess.map((a) => a.location),
    status: u.isActive ? ('active' as const) : ('inactive' as const),
  }
}

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mailer: MailerService,
  ) {}

  async list() {
    const [users, pending] = await Promise.all([
      this.prisma.client.user.findMany({
        orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        include: {
          locationAccess: {
            include: { location: { select: { id: true, name: true } } },
            orderBy: throughLocationOrder(),
          },
        },
      }),
      this.prisma.client.invitation.findMany({
        where: { status: 'pending' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ])

    const members = users.map(memberContract)
    const idsOf = (value: unknown) =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
    const offered = await this.prisma.client.location.findMany({
      where: { id: { in: [...new Set(pending.flatMap((i) => idsOf(i.locationIds)))] } },
      select: { id: true, name: true },
      orderBy: locationOrder(),
    })
    const now = new Date()
    const invited = pending.map((i) => ({
      id: i.id,
      name: i.email,
      email: i.email,
      role: i.role,
      locations: offered.filter((l) => idsOf(i.locationIds).includes(l.id)),
      status: i.expiresAt < now ? ('expired' as const) : ('invited' as const),
    }))
    return [...members, ...invited]
  }

  private assertBelow(ctx: { role: Role }, role: Role, what: string) {
    if (!roleBelow(role, ctx.role)) {
      throw new ForbiddenException({
        code: 'ROLE_TOO_LOW',
        message: `${what} is only for members below your own role`,
      })
    }
  }

  private async member(id: string) {
    const ctx = requireTenant()
    const user = await this.prisma.client.user.findUnique({
      where: { id },
      include: { locationAccess: { select: { locationId: true } } },
    })
    if (!user || user.organizationId !== ctx.organizationId) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' })
    }
    return { ctx, user }
  }

  private assertReach(user: { locationAccess: { locationId: string }[] }) {
    assertReaches(user.locationAccess.map((a) => a.locationId))
  }

  async update(id: string, dto: UpdateMemberDto) {
    const { ctx, user } = await this.member(id)
    if (user.role === 'owner')
      throw new BadRequestException({
        code: 'OWNER_PROTECTED',
        message: 'Owner cannot be modified',
      })
    if (id === ctx.userId)
      throw new BadRequestException({
        code: 'OWN_ACCOUNT_PROTECTED',
        message: 'Cannot modify your own account here',
      })
    this.assertBelow(ctx, user.role, 'Changing a member')
    if (dto.role) this.assertBelow(ctx, dto.role, 'Giving a role')
    this.assertReach(user)
    if (dto.locationIds) assertReaches(dto.locationIds)

    if (dto.locationIds) {
      await assertReferencesOwned(this.prisma.client, { locationId: dto.locationIds })
      const held = new Set(user.locationAccess.map((a) => a.locationId))
      await assertLocationsActive(
        this.prisma.client,
        dto.locationIds.filter((l) => !held.has(l)),
      )
    }

    await this.prisma.client.$transaction(async (tx) => {
      if (dto.role) await tx.user.update({ where: { id }, data: { role: dto.role } })
      if (dto.locationIds) {
        await tx.userLocation.deleteMany({ where: { userId: id } })
        if (dto.locationIds.length > 0) {
          await tx.userLocation.createMany({
            data: dto.locationIds.map((locationId) => ({ userId: id, locationId })),
          })
        }
      }
    })
    const updated = await this.prisma.client.user.findUniqueOrThrow({
      where: { id },
      include: {
        locationAccess: {
          include: { location: { select: { id: true, name: true } } },
          orderBy: throughLocationOrder(),
        },
      },
    })
    return memberContract(updated)
  }

  async resetPassword(id: string) {
    const { ctx, user } = await this.member(id)
    if (!user.isActive)
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' })
    if (!roleBelow(user.role, ctx.role)) {
      throw new ForbiddenException({
        code: 'ROLE_TOO_LOW',
        message: 'A reset can only be issued for an account below your own role',
      })
    }
    this.assertReach(user)

    const token = await this.auth.issueResetToken(user.id)
    const emailDelivered = await this.mailer.sendPasswordReset(user.email, token)
    return {
      emailDelivered,
      resetUrl: emailDelivered ? null : this.mailer.passwordResetUrl(token),
    }
  }

  async deactivate(id: string) {
    const { ctx, user } = await this.member(id)
    if (id === ctx.userId)
      throw new BadRequestException({
        code: 'OWN_ACCOUNT_PROTECTED',
        message: 'Cannot deactivate yourself',
      })
    if (user.role === 'owner')
      throw new BadRequestException({
        code: 'OWNER_PROTECTED',
        message: 'Owner cannot be deactivated',
      })
    this.assertBelow(ctx, user.role, 'Deactivating a member')
    this.assertReach(user)
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({ where: { id }, data: { isActive: false } }),
      this.prisma.client.userSession.deleteMany({ where: { userId: id } }),
    ])
    return { ok: true }
  }

  async reactivate(id: string) {
    const { ctx, user: found } = await this.member(id)
    if (found.isActive)
      throw new BadRequestException({
        code: 'MEMBER_ALREADY_ACTIVE',
        message: 'This member is already active',
      })
    this.assertBelow(ctx, found.role, 'Reactivating a member')
    this.assertReach(found)
    const user = await this.prisma.client.user.update({
      where: { id },
      data: { isActive: true, failedLoginAttempts: 0, lockoutUntil: null },
      include: {
        locationAccess: {
          include: { location: { select: { id: true, name: true } } },
          orderBy: throughLocationOrder(),
        },
      },
    })
    return memberContract(user)
  }
}
