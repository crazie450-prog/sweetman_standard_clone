import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { requireTenant, withPlatformScope } from '../../tenancy/tenant-context'
import { AuthService } from '../../auth/auth.service'
import { MailerService } from '../../mailer/mailer.service'
import { reviewedPayload, storedPayload } from '../documents/payload.schema'
import { DocumentsService } from '../documents/documents.service'
import { DocumentsQueue } from '../documents/documents.queue'
import type { ExtractionPayload } from '../documents/extraction'
import type { DocumentStatus, Prisma } from '../../generated/prisma/client'
import { pageOf, pageWindow } from '../../common/dto/pagination.dto'
import { DOCUMENT_STATUSES } from '../documents/dto/documents.dto'
import {
  UpdateAdminOrganizationDto,
  UpdateAdminUserDto,
  AdminOrganizationsQuery,
  AdminQueueQuery,
  AdminUsersQuery,
} from './dto/admin.dto'

const seconds = (doc: { createdAt: Date; updatedAt: Date }) =>
  `${Math.max(0, Math.round((doc.updatedAt.getTime() - doc.createdAt.getTime()) / 1000))}s`

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null

function userContract(u: {
  id: string
  fullName: string
  email: string
  role: string
  isActive: boolean
  isPlatformAdmin: boolean
  lockoutUntil: Date | null
  lastLoginAt: Date | null
  createdAt: Date
}) {
  const locked = u.lockoutUntil && u.lockoutUntil > new Date() ? u.lockoutUntil : null
  return {
    id: u.id,
    name: u.fullName,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    isPlatformAdmin: u.isPlatformAdmin,
    lockedUntil: iso(locked),
    lastSignIn: iso(u.lastLoginAt),
    created: u.createdAt.toISOString(),
  }
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly documentsQueue: DocumentsQueue,
    private readonly auth: AuthService,
    private readonly mailer: MailerService,
  ) {}

  /* ===== Organizations ===== */

  async organizations(query: AdminOrganizationsQuery) {
    const q = query.q?.trim()
    const where: Prisma.OrganizationWhereInput = {
      ...(query.status ? { subscriptionStatus: query.status } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { ownerEmail: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    const [orgs, total] = await Promise.all([
      this.prisma.client.organization.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
        include: { _count: { select: { locations: true, users: true } } },
      }),
      this.prisma.client.organization.count({ where }),
    ])
    const rows = orgs.map((o) => ({
      id: o.id,
      name: o.name,
      ownerEmail: o.ownerEmail,
      locations: o._count.locations,
      users: o._count.users,
      status: o.subscriptionStatus,
      planId: o.planId,
      trialEndsAt: iso(o.trialEndsAt),
      currentPeriodEnd: iso(o.currentPeriodEnd),
      hasCustomer: Boolean(o.stripeCustomerId),
      isActive: o.isActive,
      created: o.createdAt.toISOString(),
    }))
    return pageOf(rows, total, query)
  }

  organization(id: string) {
    return withPlatformScope(() => this.readOrganization(id))
  }

  private async readOrganization(id: string) {
    const org = await this.prisma.client.organization.findUnique({
      where: { id },
      include: {
        locations: {
          orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
          include: { _count: { select: { userAccess: true } } },
        },
        users: { orderBy: [{ role: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }] },
      },
    })
    if (!org)
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
      })

    const documents = await this.prisma.client.document.groupBy({
      by: ['status'],
      where: { organizationId: id },
      _count: { _all: true },
    })

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      ownerName: org.ownerName ?? '',
      ownerEmail: org.ownerEmail,
      country: org.country,
      timezone: org.timezone,
      currency: org.currency,
      isActive: org.isActive,
      created: org.createdAt.toISOString(),
      subscription: {
        status: org.subscriptionStatus,
        planId: org.planId,
        trialEndsAt: iso(org.trialEndsAt),
        currentPeriodEnd: iso(org.currentPeriodEnd),
        seats: org.billingSeats,
        stripeCustomerId: org.stripeCustomerId,
        foodCostTargetPct: Number(org.foodCostTargetPct),
      },
      locations: org.locations.map((l) => ({
        id: l.id,
        name: l.name,
        address: l.address ?? '',
        isActive: l.isActive,
        isDefault: l.isDefault,
        assignedUsers: l._count.userAccess,
      })),
      users: org.users.map(userContract),
      documents: Object.fromEntries(documents.map((d) => [d.status, d._count._all])) as Record<
        string,
        number
      >,
    }
  }

  updateOrganization(id: string, dto: UpdateAdminOrganizationDto) {
    return withPlatformScope(() => this.writeOrganization(id, dto))
  }

  private async writeOrganization(id: string, dto: UpdateAdminOrganizationDto) {
    const ctx = requireTenant()
    const org = await this.prisma.client.organization.findUnique({ where: { id } })
    if (!org)
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
      })
    if (!dto.isActive && id === ctx.organizationId) {
      throw new BadRequestException({
        code: 'OWN_ORGANIZATION_PROTECTED',
        message: 'Your own organization cannot be deactivated from here',
      })
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.organization.update({ where: { id }, data: { isActive: dto.isActive } })
      if (!dto.isActive) {
        await tx.userSession.deleteMany({ where: { user: { organizationId: id } } })
      }
    })
    return this.readOrganization(id)
  }

  /* ===== Users ===== */

  users(query: AdminUsersQuery) {
    return withPlatformScope(() => this.searchUsers(query))
  }

  private async searchUsers(query: AdminUsersQuery) {
    const needle = query.q?.trim()
    if (!needle) return pageOf([], 0, query)
    const where: Prisma.UserWhereInput = {
      OR: [
        { email: { contains: needle, mode: 'insensitive' } },
        { fullName: { contains: needle, mode: 'insensitive' } },
      ],
    }
    const [users, total] = await Promise.all([
      this.prisma.client.user.findMany({
        where,
        orderBy: [{ email: 'asc' }, { id: 'asc' }],
        ...pageWindow(query),
        include: { organization: { select: { id: true, name: true, isActive: true } } },
      }),
      this.prisma.client.user.count({ where }),
    ])
    return pageOf(
      users.map((u) => ({
        ...userContract(u),
        organization: u.organization,
      })),
      total,
      query,
    )
  }

  updateUser(id: string, dto: UpdateAdminUserDto) {
    return withPlatformScope(() => this.writeUser(id, dto))
  }

  private async targetUser(id: string) {
    const ctx = requireTenant()
    const user = await this.prisma.client.user.findUnique({
      where: { id },
      include: { organization: { select: { id: true, name: true, isActive: true } } },
    })
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' })
    if (user.id === ctx.userId)
      throw new BadRequestException({
        code: 'OWN_ACCOUNT_PROTECTED',
        message: 'Your own account is not managed here',
      })
    if (user.isPlatformAdmin) {
      throw new BadRequestException({
        code: 'PLATFORM_ADMIN_PROTECTED',
        message: 'Another platform administrator is not managed here',
      })
    }
    return user
  }

  private async writeUser(id: string, dto: UpdateAdminUserDto) {
    const user = await this.targetUser(id)
    if (dto.isActive === false && user.role === 'owner') {
      throw new BadRequestException({
        code: 'OWNER_PROTECTED',
        message: 'An owner cannot be deactivated; deactivate the organization instead',
      })
    }

    const data: Prisma.UserUpdateInput = {}
    if (dto.isActive !== undefined) data.isActive = dto.isActive
    if (dto.unlock) {
      data.lockoutUntil = null
      data.failedLoginAttempts = 0
    }

    await this.prisma.client.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) await tx.user.update({ where: { id }, data })
      if (dto.isActive === false) await tx.userSession.deleteMany({ where: { userId: id } })
    })

    const updated = await this.prisma.client.user.findUniqueOrThrow({
      where: { id },
      include: { organization: { select: { id: true, name: true, isActive: true } } },
    })
    return { ...userContract(updated), organization: updated.organization }
  }

  resetUserPassword(id: string) {
    return withPlatformScope(() => this.issueReset(id))
  }

  private async issueReset(id: string) {
    const user = await this.targetUser(id)
    if (!user.isActive)
      throw new BadRequestException({
        code: 'ACCOUNT_DEACTIVATED',
        message: 'A deactivated account cannot be reset',
      })

    const token = await this.auth.issueResetToken(user.id)
    const emailDelivered = await this.mailer.sendPasswordReset(user.email, token)
    return {
      emailDelivered,
      resetUrl: emailDelivered ? null : this.mailer.passwordResetUrl(token),
    }
  }

  /* ===== Queue ===== */

  queueState() {
    return this.documentsQueue.state()
  }

  queue(query: AdminQueueQuery) {
    return withPlatformScope(async () => this.queueRows(query))
  }

  queueSummary() {
    return withPlatformScope(async () => {
      const rows = await this.prisma.client.document.groupBy({ by: ['status'], _count: true })
      const count = (...statuses: DocumentStatus[]) =>
        rows.filter((r) => statuses.includes(r.status)).reduce((sum, r) => sum + r._count, 0)
      return {
        total: count(...DOCUMENT_STATUSES),
        processing: count('queued', 'processing'),
        requiresReview: count('requires_review'),
        failed: count('failed'),
      }
    })
  }

  private async queueRows(query: AdminQueueQuery) {
    const where = query.status ? { status: query.status } : {}
    const [docs, total] = await Promise.all([
      this.prisma.client.document.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
        include: {
          organization: { select: { name: true } },
          location: { select: { name: true } },
        },
      }),
      this.prisma.client.document.count({ where }),
    ])
    const rows = docs.map((d) => ({
      id: d.id,
      file: d.fileName,
      organization: d.organization.name,
      organizationId: d.organizationId,
      location: d.location?.name ?? 'All locations',
      type: d.type,
      status: d.status,
      error: d.error,
      duration: seconds(d),
    }))
    return pageOf(rows, total, query)
  }

  retry(id: string) {
    return withPlatformScope(() => this.documents.retry(id))
  }

  /* ===== One job ===== */

  job(id: string) {
    return withPlatformScope(() => this.readJob(id))
  }

  private async readJob(id: string) {
    const doc = await this.prisma.client.document.findUnique({
      where: { id },
      include: {
        organization: { select: { name: true } },
        location: { select: { name: true } },
        extractions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
      },
    })
    if (!doc) throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Job not found' })

    const payload = storedPayload(doc.extractions[0]?.payload)
    const ingredients = await this.prisma.client.ingredient.findMany({
      where: { organizationId: doc.organizationId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })

    return {
      id: doc.id,
      file: doc.fileName,
      organization: doc.organization.name,
      organizationId: doc.organizationId,
      location: doc.location?.name ?? 'All locations',
      type: doc.type,
      status: doc.status,
      error: doc.error,
      duration: seconds(doc),
      attempts: doc.jobId ? await this.documentsQueue.jobInfo(doc.jobId) : null,
      versions: doc.extractions.length,
      payload,
      unresolved: await this.documents.unresolvedNames(doc.organizationId, payload, doc.locationId),
      ingredients,
    }
  }

  saveExtraction(id: string, payload: ExtractionPayload) {
    return withPlatformScope(() => this.writeExtraction(id, payload))
  }

  private async writeExtraction(id: string, payload: ExtractionPayload) {
    const doc = await this.prisma.client.document.findUnique({ where: { id } })
    if (!doc) throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Job not found' })
    if (doc.status !== 'requires_review') {
      throw new ConflictException({
        code: 'DOCUMENT_NOT_IN_REVIEW',
        message: 'Only a document waiting for review can be corrected',
      })
    }
    const reviewed = reviewedPayload(payload, doc.type)
    await this.prisma.client.$transaction(async (tx) => {
      const held = await tx.document.updateMany({
        where: { id, status: 'requires_review' },
        data: { status: 'requires_review' },
      })
      if (held.count === 0) {
        throw new ConflictException({
          code: 'DOCUMENT_NOT_IN_REVIEW',
          message: 'Only a document waiting for review can be corrected',
        })
      }
      await tx.extraction.create({
        data: {
          organizationId: doc.organizationId,
          documentId: doc.id,
          payload: reviewed as object,
        },
      })
    })
    return this.readJob(id)
  }

  mapName(id: string, rawName: string, ingredientId: string) {
    return withPlatformScope(() => this.bindOneName(id, rawName, ingredientId))
  }

  private async bindOneName(id: string, rawName: string, ingredientId: string) {
    const doc = await this.prisma.client.document.findUnique({ where: { id } })
    if (!doc) throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Job not found' })
    const name = (rawName ?? '').trim()
    if (!name)
      throw new BadRequestException({ code: 'NAME_REQUIRED', message: 'A name is required' })

    const ingredient = await this.prisma.client.ingredient.findUnique({
      where: { id: ingredientId },
    })
    if (!ingredient || ingredient.organizationId !== doc.organizationId) {
      throw new BadRequestException({
        code: 'INGREDIENT_OF_OTHER_ORGANIZATION',
        message: 'That ingredient belongs to another organization',
      })
    }

    await this.documents.bindOn(doc.id, doc.organizationId, name, ingredientId)
    return this.readJob(id)
  }
}
