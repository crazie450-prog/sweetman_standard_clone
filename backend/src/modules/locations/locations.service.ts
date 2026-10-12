import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { notFoundOr } from '../../common/utils/missing'
import { changesHere, requireTenant, worksAt } from '../../tenancy/tenant-context'
import { named, refuseTaken } from '../../rules/names'
import { lockKey, serialized, type Serial } from '../../common/utils/serialize'
import { locationOrder } from '../../rules/locations'
import { BillingService } from '../../billing/billing.service'
import { CreateLocationDto, UpdateLocationDto } from './dto/locations.dto'

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  async listForCurrentUser() {
    const ctx = requireTenant()
    const access = await this.prisma.client.userLocation.findMany({
      where: { userId: ctx.userId },
      select: { locationId: true },
    })
    const ids = access.map((a) => a.locationId)
    return this.prisma.client.location.findMany({
      where: { isActive: true, ...(ids.length > 0 ? { id: { in: ids } } : {}) },
      select: { id: true, name: true },
      orderBy: locationOrder(),
    })
  }

  async listAll() {
    const rows = await this.prisma.client.location.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        isActive: true,
        isDefault: true,
        _count: { select: { userAccess: true } },
      },
    })
    return rows.map(({ _count, ...location }) => ({ ...location, people: _count.userAccess }))
  }

  private roster<T>(fn: (tx: Serial) => Promise<T>) {
    return serialized(this.prisma.client, lockKey('locations', requireTenant().organizationId), fn)
  }

  private async assertNotLast(id: string, db: Pick<Serial, 'location'>) {
    const others = await db.location.count({
      where: { isActive: true, id: { not: id } },
    })
    if (others === 0) {
      throw new BadRequestException({
        code: 'LAST_ACTIVE_LOCATION',
        message: 'This is the only active location; add or restore another before archiving it',
      })
    }
  }

  private async assertNameFree(
    name: string | undefined,
    except: string | undefined,
    db: Pick<Serial, 'location'>,
  ) {
    if (name === undefined) return
    const taken = await db.location.findFirst({
      where: named(name, except),
      select: { name: true },
    })
    if (taken) refuseTaken('location', taken.name)
  }

  async create(dto: CreateLocationDto) {
    const ctx = requireTenant()
    if (!changesHere(null)) {
      throw new ForbiddenException({
        code: 'LOCATION_ACCESS_REQUIRED',
        message: 'A location is added by someone who works at every location of the organization',
      })
    }
    const created = await this.roster(async (tx) => {
      await this.assertNameFree(dto.name, undefined, tx)
      return tx.location.create({
        data: { ...dto, organizationId: ctx.organizationId },
        select: { id: true, name: true },
      })
    })
    await this.billing.syncSeats(ctx.organizationId)
    return created
  }

  private assertWorksHere(id: string) {
    if (!worksAt(id)) {
      throw new ForbiddenException({
        code: 'LOCATION_ACCESS_REQUIRED',
        message: 'A location can only be changed by someone who works there',
      })
    }
  }

  async update(id: string, dto: UpdateLocationDto) {
    const ctx = requireTenant()
    this.assertWorksHere(id)
    const updated = await this.roster(async (tx) => {
      await this.assertNameFree(dto.name, id, tx)
      if (dto.isActive === false) await this.assertNotLast(id, tx)
      try {
        return await tx.location.update({
          where: { id },
          data: dto,
          select: { id: true, name: true, address: true, phone: true, isActive: true },
        })
      } catch (e) {
        throw notFoundOr(e, 'Location not found')
      }
    })
    if (dto.isActive !== undefined) await this.billing.syncSeats(ctx.organizationId)
    return updated
  }

  async deactivate(id: string) {
    const ctx = requireTenant()
    this.assertWorksHere(id)
    await this.roster(async (tx) => {
      await this.assertNotLast(id, tx)
      try {
        await tx.location.update({ where: { id }, data: { isActive: false } })
      } catch (e) {
        throw notFoundOr(e, 'Location not found')
      }
    })
    await this.billing.syncSeats(ctx.organizationId)
    return { ok: true }
  }
}
