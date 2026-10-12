import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { notFoundOr } from '../../common/utils/missing'
import { MENU_WRITE_MS, serialized, type Serial } from '../../common/utils/serialize'
import {
  acrossLocations,
  assertChangesHere,
  requireTenant,
  worksAt,
} from '../../tenancy/tenant-context'
import { assertCategoryKind, assertReferencesOwned } from '../../tenancy/references'
import { assertLocationsActive } from '../../rules/locations'
import { assertServedBy, servedBy, type ServedDish } from '../../rules/menus'
import { assertBuiltHere } from '../../rules/recipes'
import { dishCost } from '../../costing/costing.core'
import { roleAtLeast } from '../../common/decorators/roles.decorator'
import { num, type Numeric } from '../../common/utils/decimal'
import {
  sameKitchen,
  nameLock,
  recipeGraphLock,
  menuShapeLock,
  dishPlaceLock,
  named,
  refuseTakenInKitchen,
} from '../../rules/names'
import { CreateMenuItemDto, UpdateMenuItemDto } from './dto/menu.dto'

export const MENU_INCLUDE = {
  category: { select: { name: true } },
  location: { select: { name: true } },
  recipes: {
    include: { recipe: { select: { id: true, name: true, totalCost: true, portions: true } } },
  },
  onMenus: {
    select: { menu: { select: { id: true, name: true } } },
    orderBy: { menu: { name: 'asc' as const } },
  },
} as const

export function toContract(m: {
  id: string
  name: string
  price: Numeric
  isActive: boolean
  categoryId: string | null
  locationId: string | null
  category: { name: string } | null
  location: { name: string } | null
  recipes: {
    portions: Numeric
    recipe: { id: string; name: string; totalCost: Numeric; portions: number }
  }[]
  onMenus: { menu: { id: string; name: string } }[]
}) {
  const cost = dishCost(m.recipes)
  return {
    id: m.id,
    name: m.name,
    category: m.category?.name ?? '',
    categoryId: m.categoryId ?? null,
    locationId: m.locationId ?? null,
    location: m.location?.name ?? '',
    recipes: m.recipes.map((r) => ({
      id: r.recipe.id,
      name: r.recipe.name,
      portions: num(r.portions),
    })),
    price: num(m.price),
    cost,
    active: m.isActive,
    menus: m.onMenus.map((o) => o.menu),
  }
}

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.client.menuItem.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: MENU_INCLUDE,
    })
    return rows.map(toContract)
  }

  private async assertNameFree(
    name: string,
    locationId: string | null,
    except: string | undefined,
    db: Pick<Serial, 'menuItem'>,
  ) {
    const taken = await db.menuItem.findFirst({
      where: { ...named(name, except), ...sameKitchen(locationId) },
      select: { location: { select: { name: true } } },
    })
    if (taken) refuseTakenInKitchen('on the menu', name, taken.location)
  }

  private async readOne(id: string) {
    const row = await this.prisma.client.menuItem.findUniqueOrThrow({
      where: { id },
      include: MENU_INCLUDE,
    })
    return toContract(row)
  }

  async create(dto: CreateMenuItemDto) {
    const ctx = requireTenant()
    assertChangesHere(dto.locationId, 'A menu item')
    await assertReferencesOwned(this.prisma.client, {
      recipeId: dto.recipes?.map((r) => r.recipeId),
      locationId: dto.locationId,
      categoryId: dto.categoryId,
      menuId: dto.menuIds,
    })
    await assertCategoryKind(this.prisma.client, dto.categoryId, 'menu')
    await assertLocationsActive(this.prisma.client, dto.locationId)
    this.assertMayPlace(dto.menuIds)
    const { recipes, menuIds, ...data } = dto
    const recipeIds = dto.recipes?.map((r) => r.recipeId) ?? []
    const created = await serialized(
      this.prisma.client,
      [
        ...nameLock('menu-item', ctx.organizationId, dto.name),
        ...(recipeIds.length ? [recipeGraphLock(ctx.organizationId)] : []),
        ...(dto.menuIds?.length ? [menuShapeLock(ctx.organizationId)] : []),
      ],
      async (tx) => {
        await this.assertRecipesFit(dto.locationId ?? null, recipeIds, tx)
        await this.assertMenusServe(
          { name: dto.name, locationId: dto.locationId ?? null },
          dto.menuIds,
        )
        await this.assertNameFree(dto.name, dto.locationId ?? null, undefined, tx)
        const made = await tx.menuItem.create({
          data: {
            ...data,
            organizationId: ctx.organizationId,
            recipes: recipes?.length
              ? {
                  create: recipes.map((r) => ({ recipeId: r.recipeId, portions: r.portions ?? 1 })),
                }
              : undefined,
          },
          select: { id: true },
        })
        if (menuIds?.length) await this.placeOnMenus(tx, made.id, menuIds)
        return made
      },
      { timeout: MENU_WRITE_MS },
    )
    return this.readOne(created.id)
  }

  private async assertRecipesFit(
    locationId: string | null,
    recipeIds: string[],
    db: Pick<Serial, 'recipe'>,
  ) {
    if (recipeIds.length === 0) return
    const recipes = await acrossLocations(() =>
      db.recipe.findMany({
        where: { id: { in: recipeIds } },
        select: { name: true, locationId: true },
      }),
    )
    assertBuiltHere('a dish', locationId, recipes)
  }

  private assertMayPlace(menuIds: string[] | undefined) {
    if (menuIds === undefined) return
    const ctx = requireTenant()
    if (!roleAtLeast(ctx.role, 'manager')) {
      throw new ForbiddenException({
        code: 'ROLE_TOO_LOW',
        message: 'Requires manager role or higher to change which menus an item is on',
      })
    }
  }

  private async assertMenusServe(
    dish: ServedDish,
    menuIds: string[] | undefined,
    menuItemId?: string,
  ) {
    if (!menuIds?.length) return
    const menus = await this.prisma.client.menu.findMany({
      where: {
        id: { in: menuIds },
        ...(menuItemId ? { items: { none: { menuItemId } } } : {}),
      },
      select: {
        name: true,
        locations: { where: { location: { isActive: true } }, select: { locationId: true } },
      },
    })
    for (const menu of menus) {
      const locationIds = menu.locations.map((l) => l.locationId)
      if (locationIds.length > 0 && !locationIds.some((l) => worksAt(l))) {
        throw new NotFoundException({ code: 'MENU_NOT_FOUND', message: 'Menu not found' })
      }
      assertServedBy(dish, { name: menu.name, locationIds })
    }
  }

  private async assertNamesStillRead(
    menuItemId: string,
    locationId: string,
    db: Pick<Serial, 'menuItemAlias'>,
  ) {
    const names = await acrossLocations(() =>
      db.menuItemAlias.findMany({
        where: { menuItemId, OR: [{ locationId: null }, { locationId: { not: locationId } }] },
        select: { rawName: true },
        orderBy: [{ rawName: 'asc' }, { id: 'asc' }],
      }),
    )
    if (names.length === 0) return
    const listed = names.map((n) => n.rawName).join(', ')
    throw new BadRequestException({
      code: 'SALES_NAME_OF_OTHER_LOCATION',
      message: `${listed} ${names.length === 1 ? 'is a sales name' : 'are sales names'} of another location that ${names.length === 1 ? 'reads' : 'read'} as this dish; map ${names.length === 1 ? 'it' : 'them'} elsewhere on Sales Mapping first`,
    })
  }

  private async assertMenusKeepServing(
    menuItemId: string,
    dish: ServedDish,
    menuIds: string[] | undefined,
  ) {
    const on = await this.prisma.client.menuItemOnMenu.findMany({
      where: { menuItemId },
      select: {
        menuId: true,
        menu: {
          select: {
            name: true,
            locations: { where: { location: { isActive: true } }, select: { locationId: true } },
          },
        },
      },
    })
    const stranded = on
      .map((row) => ({
        id: row.menuId,
        name: row.menu.name,
        locationIds: row.menu.locations.map((l) => l.locationId),
      }))
      .filter(
        (menu) =>
          menuIds === undefined ||
          menuIds.includes(menu.id) ||
          (menu.locationIds.length > 0 && !menu.locationIds.some((l) => worksAt(l))),
      )
      .filter((menu) => !servedBy(dish, menu))
      .map((menu) => menu.name)
    if (stranded.length > 0) {
      throw new BadRequestException({
        code: 'DISH_NOT_SERVED_THERE',
        message: `${dish.name} would be sold where ${stranded.join(', ')} ${stranded.length === 1 ? 'is' : 'are'} not served; take it off ${stranded.length === 1 ? 'that menu' : 'those menus'} first`,
      })
    }
  }

  private async placeOnMenus(tx: Serial, menuItemId: string, chosen: string[]) {
    const placed = await tx.menuItemOnMenu.findMany({
      where: { menuItemId },
      select: {
        menuId: true,
        menu: {
          select: {
            locations: { where: { location: { isActive: true } }, select: { locationId: true } },
          },
        },
      },
    })
    const beyondReach = placed
      .filter(
        ({ menu }) =>
          menu.locations.length > 0 && !menu.locations.some((l) => worksAt(l.locationId)),
      )
      .map((p) => p.menuId)
    const menuIds = [...new Set([...chosen, ...beyondReach])]
    await tx.menuItemOnMenu.deleteMany({ where: { menuItemId, menuId: { notIn: menuIds } } })
    const current = await tx.menuItemOnMenu.findMany({
      where: { menuItemId },
      select: { menuId: true },
    })
    const on = new Set(current.map((c) => c.menuId))
    for (const menuId of menuIds.filter((m) => !on.has(m))) {
      const last = await tx.menuItemOnMenu.aggregate({
        where: { menuId },
        _max: { sortOrder: true },
      })
      await tx.menu.update({
        where: { id: menuId },
        data: { items: { create: { menuItemId, sortOrder: (last._max.sortOrder ?? -1) + 1 } } },
      })
    }
  }

  private async reach(id: string) {
    const row = await this.prisma.client.menuItem.findUnique({
      where: { id },
      select: { name: true, locationId: true },
    })
    if (!row || !worksAt(row.locationId))
      throw new NotFoundException({ code: 'MENU_ITEM_NOT_FOUND', message: 'Menu item not found' })
    return row
  }

  async update(id: string, dto: UpdateMenuItemDto) {
    const current = await this.reach(id)
    assertChangesHere(current.locationId, current.name)
    if (dto.locationId !== undefined) assertChangesHere(dto.locationId, 'A menu item')
    await assertReferencesOwned(this.prisma.client, {
      recipeId: dto.recipes?.map((r) => r.recipeId),
      locationId: dto.locationId,
      categoryId: dto.categoryId,
      menuId: dto.menuIds,
    })
    await assertCategoryKind(this.prisma.client, dto.categoryId, 'menu')
    if (dto.locationId !== current.locationId)
      await assertLocationsActive(this.prisma.client, dto.locationId)
    this.assertMayPlace(dto.menuIds)
    const recipesChecked = dto.recipes !== undefined || dto.locationId !== undefined
    const { recipes, menuIds, ...data } = dto
    const dish = {
      name: dto.name ?? current.name,
      locationId: dto.locationId === undefined ? current.locationId : (dto.locationId ?? null),
    }
    const menusChecked =
      dto.name !== undefined || dto.locationId !== undefined || menuIds !== undefined
    const organizationId = requireTenant().organizationId
    await serialized(
      this.prisma.client,
      [
        ...nameLock('menu-item', organizationId, dish.name),
        ...(recipesChecked ? [recipeGraphLock(organizationId)] : []),
        ...(menusChecked ? [menuShapeLock(organizationId)] : []),
        ...(dto.locationId !== undefined ? [dishPlaceLock(organizationId, id)] : []),
      ],
      async (tx) => {
        if (dto.locationId !== undefined && dish.locationId !== null)
          await this.assertNamesStillRead(id, dish.locationId, tx)
        if (menusChecked) {
          await this.assertMenusServe(dish, menuIds, id)
          if (dto.locationId !== undefined) await this.assertMenusKeepServing(id, dish, menuIds)
        }
        if (recipesChecked) {
          const recipeIds =
            dto.recipes?.map((r) => r.recipeId) ??
            (
              await tx.menuItemRecipe.findMany({
                where: { menuItemId: id },
                select: { recipeId: true },
              })
            ).map((r) => r.recipeId)
          await this.assertRecipesFit(dish.locationId, recipeIds, tx)
        }
        if (dto.name !== undefined || dto.locationId !== undefined) {
          await this.assertNameFree(dish.name, dish.locationId, id, tx)
        }
        try {
          await tx.menuItem.update({ where: { id }, data })
        } catch (e) {
          throw notFoundOr(e, 'Menu item not found')
        }
        if (recipes) {
          await tx.menuItemRecipe.deleteMany({ where: { menuItemId: id } })
          await tx.menuItemRecipe.createMany({
            data: recipes.map((r) => ({
              menuItemId: id,
              recipeId: r.recipeId,
              portions: r.portions ?? 1,
            })),
          })
        }
        if (menuIds) await this.placeOnMenus(tx, id, menuIds)
      },
      { timeout: MENU_WRITE_MS },
    )
    return this.readOne(id)
  }

  async remove(id: string) {
    const current = await this.reach(id)
    assertChangesHere(current.locationId, current.name)
    try {
      await this.prisma.client.menuItem.delete({ where: { id } })
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'P2003') {
        throw new BadRequestException({
          code: 'MENU_ITEM_HAS_SALES',
          message: 'Menu item has sales history; deactivate it instead',
        })
      }
      throw new NotFoundException({ code: 'MENU_ITEM_NOT_FOUND', message: 'Menu item not found' })
    }
    return { ok: true }
  }
}
