import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { notFoundOr } from '../../common/utils/missing'
import {
  changesHere,
  requireTenant,
  withoutActiveLocation,
  worksAt,
} from '../../tenancy/tenant-context'
import { assertReferencesOwned } from '../../tenancy/references'
import { money, num, percent } from '../../common/utils/decimal'
import { MENU_INCLUDE, toContract } from './menu.service'
import { assertServedBy, servedBy, type ServingMenu } from '../../rules/menus'
import { assertLocationsActive, throughLocationOrder } from '../../rules/locations'
import { nameLock, menuShapeLock, named, refuseTaken } from '../../rules/names'
import { MENU_WRITE_MS, serialized, type Serial } from '../../common/utils/serialize'
import { CreateMenuDto, UpdateMenuDto } from './dto/menus.dto'

type ItemRow = ReturnType<typeof toContract>

export function analytics(all: ItemRow[], target: number) {
  const items = all.filter((i) => i.active)
  const costed = items.filter((i) => i.recipes.length > 0)
  const price = money(costed.reduce((sum, i) => sum + i.price, 0))
  const cost = money(costed.reduce((sum, i) => sum + i.cost, 0))
  return {
    items: items.length,
    price,
    cost,
    margin: money(price - cost),
    marginPct: percent(price - cost, price),
    foodCostPct: percent(cost, price),
    target,
    overTarget: costed.filter((i) => (percent(i.cost, i.price) ?? 0) > target).length,
    uncosted: items.length - costed.length,
  }
}

const MENU_LIST_INCLUDE = {
  locations: {
    where: { location: { isActive: true } },
    include: { location: { select: { id: true, name: true } } },
    orderBy: throughLocationOrder(),
  },
  items: { include: { menuItem: { include: MENU_INCLUDE } }, orderBy: { sortOrder: 'asc' } },
} as const

/* ===== Service ===== */

@Injectable()
export class MenusService {
  constructor(private readonly prisma: PrismaService) {}

  private async target() {
    const organization = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: requireTenant().organizationId },
      select: { foodCostTargetPct: true },
    })
    return num(organization.foodCostTargetPct)
  }

  async list() {
    const { locationId, assignedLocationIds } = requireTenant()
    const scope = locationId
      ? { equals: locationId }
      : assignedLocationIds?.length
        ? { in: assignedLocationIds }
        : null
    const [rows, target] = await Promise.all([
      this.prisma.client.menu.findMany({
        where: scope
          ? {
              OR: [{ locations: { some: { locationId: scope } } }, { locations: { none: {} } }],
            }
          : undefined,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        include: MENU_LIST_INCLUDE,
      }),
      this.target(),
    ])
    return rows.map((menu) => {
      const items = menu.items.map((i) => toContract(i.menuItem))
      return {
        id: menu.id,
        name: menu.name,
        description: menu.description ?? '',
        isActive: menu.isActive,
        locations: menu.locations.map((l) => l.location),
        analytics: analytics(items, target),
      }
    })
  }

  private reachable(locations: { location: { id: string } }[] | { locationId: string }[]) {
    const ids = locations.map((l) => ('locationId' in l ? l.locationId : l.location.id))
    return ids.length === 0 || ids.some((id) => worksAt(id))
  }

  private async reach(id: string) {
    const menu = await this.prisma.client.menu.findUnique({
      where: { id },
      select: { locations: { select: { locationId: true } } },
    })
    if (!menu || !this.reachable(menu.locations))
      throw new NotFoundException({ code: 'MENU_NOT_FOUND', message: 'Menu not found' })
  }

  private async beyondReach(menuId: string) {
    const { organizationId, assignedLocationIds } = requireTenant()
    if (!assignedLocationIds?.length) return []
    const placed = await this.prisma.client.menuItemOnMenu.findMany({
      where: { menuId, menu: { organizationId } },
      select: { menuItemId: true, menuItem: { select: { locationId: true } } },
    })
    return placed.filter((p) => !worksAt(p.menuItem.locationId)).map((p) => p.menuItemId)
  }

  private assertServedWhereYouWork(locationIds: string[] | undefined) {
    if (locationIds?.some((id) => !worksAt(id))) {
      throw new ForbiddenException({
        code: 'LOCATION_ACCESS_REQUIRED',
        message: 'A menu can only be served at locations you work at',
      })
    }
  }

  private assertNotEverywhere(locationIds: string[]) {
    if (locationIds.length === 0 && !changesHere(null)) {
      throw new ForbiddenException({
        code: 'LOCATION_ACCESS_REQUIRED',
        message:
          'A menu assigned to no location is added and changed only by someone who works at every location; tick the locations you work at',
      })
    }
  }

  private async readOne(id: string) {
    await this.reach(id)
    const [menu, target] = await Promise.all([
      this.prisma.client.menu.findUnique({ where: { id }, include: MENU_LIST_INCLUDE }),
      this.target(),
    ])
    if (!menu) throw new NotFoundException({ code: 'MENU_NOT_FOUND', message: 'Menu not found' })
    const items = menu.items.map((i) => toContract(i.menuItem))
    return {
      id: menu.id,
      name: menu.name,
      description: menu.description ?? '',
      isActive: menu.isActive,
      locations: menu.locations.map((l) => l.location),
      items,
      analytics: analytics(items, target),
    }
  }

  async get(id: string) {
    return this.readOne(id)
  }

  private async activeOnly(locationIds: string[]) {
    if (locationIds.length === 0) return []
    const active = await this.prisma.client.location.findMany({
      where: { id: { in: locationIds }, isActive: true },
      select: { id: true },
    })
    return active.map((l) => l.id)
  }

  private async serving(id: string) {
    const menu = await this.prisma.client.menu.findUnique({
      where: { id },
      select: {
        name: true,
        locations: { where: { location: { isActive: true } }, select: { locationId: true } },
        items: { select: { menuItemId: true } },
      },
    })
    if (!menu) throw new NotFoundException({ code: 'MENU_NOT_FOUND', message: 'Menu not found' })
    return {
      name: menu.name,
      locationIds: menu.locations.map((l) => l.locationId),
      itemIds: menu.items.map((i) => i.menuItemId),
    }
  }

  private async assertStillServed(menu: ServingMenu, menuItemIds: string[]) {
    if (menuItemIds.length === 0) return
    const dishes = await withoutActiveLocation(() =>
      this.prisma.client.menuItem.findMany({
        where: { id: { in: menuItemIds } },
        select: { name: true, locationId: true },
      }),
    )
    const stranded = dishes.filter((dish) => !servedBy(dish, menu)).map((dish) => dish.name)
    if (stranded.length > 0) {
      throw new BadRequestException({
        code: 'MENU_STILL_SELLING',
        message: `${menu.name} would stop being served where ${stranded.join(', ')} ${stranded.length === 1 ? 'is' : 'are'} sold; take ${stranded.length === 1 ? 'it' : 'them'} off the menu first`,
      })
    }
  }

  private async assertIncludable(
    menu: ServingMenu,
    menuItemIds: string[] | undefined,
    kept: Set<string>,
  ) {
    const added = (menuItemIds ?? []).filter((id) => !kept.has(id))
    if (added.length === 0) return
    const dishes = await withoutActiveLocation(() =>
      this.prisma.client.menuItem.findMany({
        where: { id: { in: added } },
        select: { id: true, name: true, locationId: true },
      }),
    )
    if (dishes.length !== added.length)
      throw new BadRequestException({ code: 'UNKNOWN_MENU_ITEM', message: 'Unknown menuItemId' })
    for (const dish of dishes) assertServedBy(dish, menu)
  }

  async available(id: string) {
    await this.reach(id)
    const menu = await this.serving(id)
    const rows = await withoutActiveLocation(() =>
      this.prisma.client.menuItem.findMany({
        where: {
          id: { notIn: menu.itemIds },
          ...(menu.locationIds.length
            ? { OR: [{ locationId: null }, { locationId: { in: menu.locationIds } }] }
            : {}),
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        include: MENU_INCLUDE,
      }),
    )
    return rows.map(toContract)
  }

  private async assertNameFree(name: string, except: string | undefined, db: Pick<Serial, 'menu'>) {
    const taken = await db.menu.findFirst({ where: named(name, except), select: { name: true } })
    if (taken) refuseTaken('menu', taken.name)
  }

  async create(dto: CreateMenuDto) {
    const ctx = requireTenant()
    this.assertServedWhereYouWork(dto.locationIds)
    this.assertNotEverywhere(dto.locationIds ?? [])
    await assertReferencesOwned(this.prisma.client, { locationId: dto.locationIds })
    await assertLocationsActive(this.prisma.client, dto.locationIds)

    const locks = [
      menuShapeLock(ctx.organizationId),
      ...nameLock('menu', ctx.organizationId, dto.name),
    ]
    const created = await serialized(
      this.prisma.client,
      locks,
      async (tx) => {
        await this.assertIncludable(
          { name: dto.name.trim(), locationIds: dto.locationIds ?? [] },
          dto.menuItemIds,
          new Set(),
        )
        await this.assertNameFree(dto.name, undefined, tx)
        return tx.menu.create({
          data: {
            organizationId: ctx.organizationId,
            name: dto.name.trim(),
            description: dto.description,
            isActive: dto.isActive,
            locations: dto.locationIds?.length
              ? { create: dto.locationIds.map((locationId) => ({ locationId })) }
              : undefined,
            items: dto.menuItemIds?.length
              ? {
                  create: dto.menuItemIds.map((menuItemId, sortOrder) => ({
                    menuItemId,
                    sortOrder,
                  })),
                }
              : undefined,
          },
          select: { id: true },
        })
      },
      { timeout: MENU_WRITE_MS },
    )
    return this.readOne(created.id)
  }

  async update(id: string, request: UpdateMenuDto) {
    await this.reach(id)
    const organizationId = requireTenant().organizationId
    const locks = [menuShapeLock(organizationId), ...nameLock('menu', organizationId, request.name)]
    await serialized(
      this.prisma.client,
      locks,
      async (tx) => {
        const current = await this.serving(id)
        this.assertNotEverywhere(current.locationIds)
        this.assertServedWhereYouWork(
          request.locationIds?.filter((l) => !current.locationIds.includes(l)),
        )
        const dto = {
          ...request,
          locationIds: request.locationIds && [
            ...new Set([...request.locationIds, ...current.locationIds.filter((l) => !worksAt(l))]),
          ],
          menuItemIds: request.menuItemIds && [
            ...new Set([...request.menuItemIds, ...(await this.beyondReach(id))]),
          ],
        }
        if (dto.locationIds) this.assertNotEverywhere(dto.locationIds)
        await assertReferencesOwned(this.prisma.client, { locationId: dto.locationIds })
        await assertLocationsActive(this.prisma.client, dto.locationIds)
        const serving = {
          name: dto.name?.trim() ?? current.name,
          locationIds: dto.locationIds ?? current.locationIds,
        }
        await this.assertIncludable(serving, dto.menuItemIds, new Set(current.itemIds))
        if (dto.locationIds) {
          const staying = dto.menuItemIds ?? current.itemIds
          await this.assertStillServed(
            { ...serving, locationIds: await this.activeOnly(dto.locationIds) },
            staying.filter((itemId) => current.itemIds.includes(itemId)),
          )
        }
        if (dto.name !== undefined) await this.assertNameFree(dto.name, id, tx)
        await tx.menu.update({
          where: { id },
          data: {
            ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
            ...(dto.description === undefined ? {} : { description: dto.description }),
            ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
          },
        })
        if (dto.locationIds) {
          await tx.menuOnLocation.deleteMany({ where: { menuId: id } })
          if (dto.locationIds.length) {
            await tx.menuOnLocation.createMany({
              data: dto.locationIds.map((locationId) => ({ menuId: id, locationId })),
            })
          }
        }
        if (dto.menuItemIds) {
          await tx.menuItemOnMenu.deleteMany({ where: { menuId: id } })
          if (dto.menuItemIds.length) {
            await tx.menuItemOnMenu.createMany({
              data: dto.menuItemIds.map((menuItemId, sortOrder) => ({
                menuId: id,
                menuItemId,
                sortOrder,
              })),
            })
          }
        }
      },
      { timeout: MENU_WRITE_MS },
    )
    return this.readOne(id)
  }

  async remove(id: string) {
    await this.reach(id)
    const { locationIds } = await this.serving(id)
    this.assertNotEverywhere(locationIds)
    if (locationIds.some((l) => !worksAt(l))) {
      throw new ForbiddenException({
        code: 'LOCATION_ACCESS_REQUIRED',
        message:
          'This menu is also served at locations you do not work at; take your locations off it instead of deleting it',
      })
    }
    try {
      await this.prisma.client.menu.delete({ where: { id } })
    } catch (e) {
      throw notFoundOr(e, 'Menu not found')
    }
    return { ok: true }
  }
}
