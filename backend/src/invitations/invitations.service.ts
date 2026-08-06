import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import * as argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { MailerService } from '../mailer/mailer.service'
import { requireTenant } from '../tenancy/tenant-context'
import type { Role } from '../generated/prisma/client'

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  async list() {
    return this.prisma.client.invitation.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
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

    const existingUser = await this.prisma.client.user.findUnique({ where: { email } })
    if (existingUser) throw new ConflictException('User with this email already exists')

    const pending = await this.prisma.client.invitation.findFirst({
      where: { email, status: 'pending' },
    })
    if (pending) throw new ConflictException('Invitation for this email is already pending')

    const locationIds = input.locationIds ?? []
    if (locationIds.length > 0) {
      const owned = await this.prisma.client.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true },
      })
      if (owned.length !== locationIds.length) {
        throw new BadRequestException('Unknown location in locationIds')
      }
    }

    const token = randomBytes(32).toString('hex')
    const invitation = await this.prisma.client.invitation.create({
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

    const org = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { name: true },
    })
    const emailDelivered = await this.mailer.sendInvitation(email, org.name, token)

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
    if (!inv || inv.status !== 'pending') throw new NotFoundException('Invitation not found')

    const token = randomBytes(32).toString('hex')
    const updated = await this.prisma.client.invitation.update({
      where: { id },
      data: { token, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
    })

    const org = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: inv.organizationId },
      select: { name: true },
    })
    const emailDelivered = await this.mailer.sendInvitation(inv.email, org.name, token)

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
    if (!inv || inv.status !== 'pending') throw new NotFoundException('Invitation not found')
    await this.prisma.client.invitation.update({ where: { id }, data: { status: 'revoked' } })
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
      throw new NotFoundException('Invitation is invalid')
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired')
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
      throw new NotFoundException('Invitation is invalid')
    }
    if (invitation.expiresAt < new Date()) {
      await this.prisma.client.invitation.update({
        where: { id: invitation.id },
        data: { status: 'expired' },
      })
      throw new BadRequestException('Invitation has expired')
    }
    const existing = await this.prisma.client.user.findUnique({
      where: { email: invitation.email },
    })
    if (existing) throw new ConflictException('User already exists')

    const hashed = await argon2.hash(input.password)
    const locationIds = (invitation.locationIds as string[]) ?? []

    const user = await this.prisma.client.$transaction(async (tx) => {
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
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted', acceptedAt: new Date() },
      })
      return created
    })

    return user
  }
}
