import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { notFoundCode, notFoundOr } from '../../common/utils/missing'
import { serialized, type Serial } from '../../common/utils/serialize'
import { assertChangesHere, requireTenant, worksAt } from '../../tenancy/tenant-context'
import { assertCategoryKind, assertReferencesOwned } from '../../tenancy/references'
import { assertLocationsActive } from '../../rules/locations'
import { assertBuiltHere, componentMeasure, isPortionUnit } from '../../rules/recipes'
import { roleAtLeast } from '../../common/decorators/roles.decorator'
import { money, num, numOrNull } from '../../common/utils/decimal'
import { conversionRules, CostingService, measuringRules } from '../../costing/costing.service'
import {
  componentContribution,
  ingredientLineCost,
  recipeFoodCostPct,
  recipesContaining,
} from '../../costing/costing.core'
import { isConvertible, normalizeUnit, type IngredientConversion } from '../../costing/units'
import {
  sameKitchen,
  nameLock,
  recipeGraphLock,
  named,
  refuseTakenInKitchen,
  unitRulesLock,
} from '../../rules/names'
import {
  CreateRecipeDto,
  UpdateRecipeDto,
  AddComponentDto,
  UpdateComponentDto,
} from './dto/recipes.dto'

const UNPRICED = { where: { ingredient: { costPerUnit: { lte: 0 } } } } as const

const MENU_USAGE_SELECT = {
  select: { portions: true, menuItem: { select: { price: true } } },
} as const

type MenuUsageRow = { portions: Prisma.Decimal; menuItem: { price: Prisma.Decimal } }

const menuUsageOf = (rows: MenuUsageRow[]) =>
  rows.map((u) => ({ portions: num(u.portions), price: num(u.menuItem.price) }))

// ------------------------------------------------------------------ Service
@Injectable()
export class RecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService,
  ) {}

  async list() {
    const rows = await this.prisma.client.recipe.findMany({
      where: { status: { not: 'archived' } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: {
        category: { select: { name: true } },
        location: { select: { id: true, name: true } },
        _count: { select: { components: true, usedIn: true, ingredients: UNPRICED } },
        menuUsage: MENU_USAGE_SELECT,
      },
    })
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category?.name ?? '',
      description: r.description ?? '',
      status: r.status,
      cost: num(r.totalCost),
      targetFoodCostPct: numOrNull(r.targetFoodCostPct),
      foodCostPct: recipeFoodCostPct(
        { totalCost: num(r.totalCost), portions: r.portions },
        menuUsageOf(r.menuUsage),
      ),
      portions: r.portions,
      yieldAmount: numOrNull(r.yieldAmount),
      yieldUnit: r.yieldUnit,
      nested: r._count.components,
      unpriced: r._count.ingredients,
      usedIn: r._count.usedIn,
      location: r.location ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }))
  }

  async get(id: string) {
    const r = await this.prisma.client.recipe.findUnique({
      where: { id },
      include: {
        category: { select: { name: true } },
        location: { select: { id: true, name: true } },
        _count: { select: { components: true, ingredients: UNPRICED } },
        menuUsage: MENU_USAGE_SELECT,
      },
    })
    if (!r || !worksAt(r.locationId))
      throw new NotFoundException({ code: 'RECIPE_NOT_FOUND', message: 'Recipe not found' })
    return {
      id: r.id,
      name: r.name,
      category: r.category?.name ?? '',
      cost: num(r.totalCost),
      targetFoodCostPct: numOrNull(r.targetFoodCostPct),
      foodCostPct: recipeFoodCostPct(
        { totalCost: num(r.totalCost), portions: r.portions },
        menuUsageOf(r.menuUsage),
      ),
      portions: r.portions,
      nested: r._count.components,
      unpriced: r._count.ingredients,
      location: r.location ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }
  }

  async detail(id: string) {
    const r = await this.prisma.client.recipe.findUnique({
      where: { id },
      include: {
        category: { select: { name: true } },
        ingredients: {
          orderBy: { order: 'asc' },
          include: { ingredient: { select: { name: true, costPerUnit: true, unit: true } } },
        },
        components: {
          orderBy: { order: 'asc' },
          include: {
            component: {
              select: {
                id: true,
                name: true,
                totalCost: true,
                portions: true,
                yieldAmount: true,
                yieldUnit: true,
              },
            },
          },
        },
        usedIn: {
          select: { parent: { select: { id: true, name: true, locationId: true } } },
          orderBy: { parent: { name: 'asc' } },
        },
        menuUsage: {
          select: {
            portions: true,
            menuItem: { select: { id: true, name: true, price: true, locationId: true } },
          },
          orderBy: { menuItem: { name: 'asc' } },
        },
        location: { select: { id: true, name: true } },
      },
    })
    if (!r || !worksAt(r.locationId))
      throw new NotFoundException({ code: 'RECIPE_NOT_FOUND', message: 'Recipe not found' })
    const edges = await this.prisma.client.recipeComponent.findMany({
      where: { parent: { organizationId: requireTenant().organizationId } },
      select: { parentId: true, componentId: true },
    })
    const conversions = await conversionRules(this.prisma.client)
    return {
      id: r.id,
      name: r.name,
      category: r.category?.name ?? '',
      categoryId: r.categoryId ?? null,
      locationId: r.locationId ?? null,
      location: r.location ?? null,
      description: r.description ?? '',
      portions: r.portions,
      targetFoodCostPct: numOrNull(r.targetFoodCostPct),
      foodCostPct: recipeFoodCostPct(
        { totalCost: num(r.totalCost), portions: r.portions },
        menuUsageOf(r.menuUsage),
      ),
      cost: num(r.totalCost),
      yieldAmount: numOrNull(r.yieldAmount),
      yieldUnit: r.yieldUnit,
      ingredients: r.ingredients.map((ri) => ({
        ingredientId: ri.ingredientId,
        name: ri.ingredient.name,
        qty: num(ri.quantity),
        unit: ri.unit,
        prepNote: ri.prepNote ?? '',
        cost: money(
          ingredientLineCost({
            quantity: num(ri.quantity),
            costPerUnit: num(ri.ingredient.costPerUnit),
            unit: ri.unit,
            pricedIn: ri.ingredient.unit,
            conversions: conversions(ri.ingredientId, r.id),
          }),
        ),
      })),
      components: r.components.map((c) => ({
        componentId: c.componentId,
        name: c.component.name,
        qty: num(c.quantity),
        unit: c.unit,
        yieldAmount: numOrNull(c.component.yieldAmount),
        yieldUnit: c.component.yieldUnit,
        cost: money(
          componentContribution(
            {
              totalCost: num(c.component.totalCost),
              portions: c.component.portions,
              yieldAmount: numOrNull(c.component.yieldAmount),
              yieldUnit: c.component.yieldUnit,
            },
            { quantity: num(c.quantity), unit: c.unit },
            measuringRules(conversions, r.id, c.componentId),
          ),
        ),
        link: c.component.id,
      })),
      usedBy: {
        recipes: r.usedIn
          .filter((u) => worksAt(u.parent.locationId))
          .map((u) => ({ id: u.parent.id, name: u.parent.name })),
        dishes: r.menuUsage
          .filter((u) => worksAt(u.menuItem.locationId))
          .map((u) => ({ id: u.menuItem.id, name: u.menuItem.name })),
      },
      containedBy: recipesContaining(r.id, edges),
    }
  }

  private async measuringRules(
    db: Pick<Serial, 'unitConversion'>,
    parentId: string,
    componentId: string,
  ): Promise<IngredientConversion[]> {
    return measuringRules(await conversionRules(db), parentId, componentId)
  }

  private assertYieldStated(dto: { yieldAmount?: number | null; yieldUnit?: string | null }) {
    if (dto.yieldAmount === undefined && dto.yieldUnit === undefined) return
    const amount = dto.yieldAmount ?? null
    const unit = dto.yieldUnit?.trim() || null
    if ((amount === null) !== (unit === null)) {
      throw new BadRequestException({
        code: 'YIELD_INCOMPLETE',
        message: 'A yield needs both an amount and a unit, or neither',
      })
    }
    if (amount !== null && amount <= 0) {
      throw new BadRequestException({
        code: 'YIELD_NOT_POSITIVE',
        message: 'A yield must be above zero',
      })
    }
  }

  private async assertComponentUnit(
    parentId: string,
    componentId: string,
    unit: string,
    db: Serial,
  ) {
    if (isPortionUnit(unit)) return
    const component = await db.recipe.findUniqueOrThrow({
      where: { id: componentId },
      select: { name: true, yieldAmount: true, yieldUnit: true },
    })
    const refusal = componentMeasure(
      {
        name: component.name,
        yieldAmount: numOrNull(component.yieldAmount),
        yieldUnit: component.yieldUnit,
      },
      unit,
      await this.measuringRules(db, parentId, componentId),
    )
    if (refusal) throw new BadRequestException({ code: 'COMPONENT_UNIT_INVALID', message: refusal })
  }

  private async assertYieldStillMeasured(
    id: string,
    name: string,
    next: { yieldAmount: number | null; yieldUnit: string | null },
    db: Serial,
  ) {
    const edges = await db.recipeComponent.findMany({
      where: { componentId: id, parent: { organizationId: requireTenant().organizationId } },
      select: { unit: true, parentId: true, parent: { select: { name: true } } },
    })
    const rulesFor = await conversionRules(db)
    const held = edges.filter(
      (e) =>
        componentMeasure({ name, ...next }, e.unit, measuringRules(rulesFor, e.parentId, id)) !==
        null,
    )
    if (held.length === 0) return
    const parents = [...new Set(held.map((e) => e.parent.name))]
    const units = [...new Set(held.map((e) => normalizeUnit(e.unit)))]
    throw new BadRequestException({
      code: 'RECIPE_MEASURED_BY_PARENTS',
      message: `${parents.join(', ')} ${parents.length === 1 ? 'measures' : 'measure'} this recipe in ${units.join(', ')}; change that to portions first, or keep a yield those units reach`,
    })
  }

  private async assertLineUnits(
    lines: { ingredientId: string; unit: string }[] | undefined,
    db: Serial,
    recipeId?: string,
  ) {
    if (!lines?.length) return
    const [ingredients, conversions] = await Promise.all([
      db.ingredient.findMany({
        where: { id: { in: lines.map((l) => l.ingredientId) } },
        select: { id: true, name: true, unit: true },
      }),
      conversionRules(db),
    ])
    const byId = new Map(ingredients.map((i) => [i.id, i]))
    for (const line of lines) {
      const ingredient = byId.get(line.ingredientId)
      if (!ingredient) continue
      if (isConvertible(line.unit, ingredient.unit, conversions(ingredient.id, recipeId))) continue
      throw new BadRequestException({
        code: 'UNIT_NOT_CONVERTIBLE',
        message:
          `${ingredient.name} is priced in ${ingredient.unit}, and ${line.unit} does not convert to it. ` +
          'Record a unit conversion first, or state the quantity in a unit of the same kind.',
      })
    }
  }

  private async assertNameFree(
    name: string,
    locationId: string | null,
    except: string | undefined,
    db: Pick<Serial, 'recipe'>,
  ) {
    const taken = await db.recipe.findFirst({
      where: { ...named(name, except), ...sameKitchen(locationId) },
      select: { location: { select: { name: true } } },
    })
    if (taken) refuseTakenInKitchen('a recipe', name, taken.location)
  }

  async create(dto: CreateRecipeDto) {
    const ctx = requireTenant()
    assertChangesHere(dto.locationId, 'A recipe')
    await assertReferencesOwned(this.prisma.client, {
      ingredientId: dto.ingredients?.map((i) => i.ingredientId),
      locationId: dto.locationId,
      categoryId: dto.categoryId,
    })
    await assertCategoryKind(this.prisma.client, dto.categoryId, 'recipe')
    await assertLocationsActive(this.prisma.client, dto.locationId)
    this.assertYieldStated(dto)
    const { ingredients, ...data } = dto
    const created = await serialized(
      this.prisma.client,
      [...nameLock('recipe', ctx.organizationId, dto.name), unitRulesLock(ctx.organizationId)],
      async (tx) => {
        await this.assertLineUnits(ingredients, tx)
        await this.assertNameFree(dto.name, dto.locationId ?? null, undefined, tx)
        return tx.recipe.create({
          data: {
            ...data,
            organizationId: ctx.organizationId,
            ingredients: ingredients?.length
              ? { create: ingredients.map((i, order) => ({ ...i, order })) }
              : undefined,
          },
        })
      },
    )
    await this.costing.recalcOrganization(ctx.organizationId)
    return this.get(created.id)
  }

  private async reach(id: string, missing = 'Recipe not found') {
    const r = await this.prisma.client.recipe.findUnique({
      where: { id },
      select: { name: true, locationId: true, yieldAmount: true, yieldUnit: true },
    })
    if (!r || !worksAt(r.locationId))
      throw new NotFoundException({ code: notFoundCode(missing), message: missing })
    return { ...r, yieldAmount: numOrNull(r.yieldAmount) }
  }

  private async reachToChange(id: string) {
    const r = await this.reach(id)
    assertChangesHere(r.locationId, r.name)
    return r
  }

  async update(id: string, dto: UpdateRecipeDto) {
    const current = await this.reachToChange(id)
    await assertReferencesOwned(this.prisma.client, {
      ingredientId: dto.ingredients?.map((i) => i.ingredientId),
      locationId: dto.locationId,
      categoryId: dto.categoryId,
    })
    await assertCategoryKind(this.prisma.client, dto.categoryId, 'recipe')
    if (dto.locationId !== current.locationId)
      await assertLocationsActive(this.prisma.client, dto.locationId)
    this.assertYieldStated(dto)
    const { ingredients, ...data } = dto
    const name = dto.name ?? current.name
    const organizationId = requireTenant().organizationId
    const moving = dto.locationId !== undefined && (dto.locationId ?? null) !== current.locationId
    await serialized(
      this.prisma.client,
      [
        ...nameLock('recipe', organizationId, name),
        ...(moving ? [recipeGraphLock(organizationId)] : []),
        unitRulesLock(organizationId),
      ],
      async (tx) => {
        if (dto.yieldAmount !== undefined || dto.yieldUnit !== undefined) {
          await this.assertYieldStillMeasured(
            id,
            current.name,
            {
              yieldAmount: dto.yieldAmount === undefined ? current.yieldAmount : dto.yieldAmount,
              yieldUnit:
                dto.yieldUnit === undefined ? current.yieldUnit : dto.yieldUnit?.trim() || null,
            },
            tx,
          )
        }
        await this.assertLineUnits(ingredients, tx, id)
        if (dto.name !== undefined || dto.locationId !== undefined) {
          await this.assertNameFree(
            name,
            dto.locationId === undefined ? current.locationId : (dto.locationId ?? null),
            id,
            tx,
          )
          if (moving) await this.assertMovable(id, current.locationId, dto.locationId ?? null, tx)
        }
        try {
          await tx.recipe.update({ where: { id }, data })
        } catch (e) {
          throw notFoundOr(e, 'Recipe not found')
        }
        if (ingredients) {
          await tx.recipeIngredient.deleteMany({ where: { recipeId: id } })
          await tx.recipeIngredient.createMany({
            data: ingredients.map((i, order) => ({ ...i, recipeId: id, order })),
          })
        }
      },
    )
    await this.costing.recalcOrganization(requireTenant().organizationId)
    return this.get(id)
  }

  private async assertMovable(
    id: string,
    from: string | null,
    locationId: string | null,
    db: Pick<Serial, 'recipeComponent' | 'menuItemRecipe'>,
  ) {
    const ctx = requireTenant()
    if (!roleAtLeast(ctx.role, 'manager')) {
      throw new ForbiddenException({
        code: 'ROLE_TOO_LOW',
        message: 'Only a manager or above moves a recipe to another location',
      })
    }
    const assigned = ctx.assignedLocationIds ?? []
    const outside = (at: string | null) =>
      assigned.length > 0 && (at === null || !assigned.includes(at))
    if (outside(from) || outside(locationId)) {
      throw new ForbiddenException({
        code: 'LOCATION_ACCESS_REQUIRED',
        message: 'A recipe can only be moved between locations you work at',
      })
    }

    const elsewhere = (at: string | null) => locationId !== null && at !== locationId
    const [parents, dishes, components] = await Promise.all([
      db.recipeComponent.findMany({
        where: { componentId: id, parent: { organizationId: ctx.organizationId } },
        select: { parent: { select: { name: true, locationId: true } } },
      }),
      db.menuItemRecipe.findMany({
        where: { recipeId: id, menuItem: { organizationId: ctx.organizationId } },
        select: { menuItem: { select: { name: true, locationId: true } } },
      }),
      db.recipeComponent.findMany({
        where: { parentId: id, parent: { organizationId: ctx.organizationId } },
        select: { component: { select: { name: true, locationId: true } } },
      }),
    ])
    const blocking = [
      ...parents.filter((p) => elsewhere(p.parent.locationId)).map((p) => p.parent.name),
      ...dishes.filter((d) => elsewhere(d.menuItem.locationId)).map((d) => d.menuItem.name),
      ...components
        .filter((c) => c.component.locationId !== null && c.component.locationId !== locationId)
        .map((c) => c.component.name),
    ]
    const names = [...new Set(blocking)]
    if (names.length) {
      throw new BadRequestException({
        code: 'RECIPE_CONNECTED_ELSEWHERE',
        message: `This recipe is connected to ${names.join(', ')}, which ${names.length === 1 ? 'is' : 'are'} not at that location; move them together or keep the recipe for all locations`,
      })
    }
  }

  async remove(id: string) {
    await this.reachToChange(id)
    try {
      await this.prisma.client.recipe.delete({ where: { id } })
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'P2003') {
        throw new BadRequestException({
          code: 'RECIPE_IN_USE',
          message: 'Recipe is used as a component or menu item and cannot be deleted',
        })
      }
      throw new NotFoundException({ code: 'RECIPE_NOT_FOUND', message: 'Recipe not found' })
    }
    await this.costing.recalcOrganization(requireTenant().organizationId)
    return { ok: true }
  }

  async addComponent(parentId: string, dto: AddComponentDto) {
    const ctx = requireTenant()
    await this.reach(dto.componentId, 'Component recipe not found')
    await this.reachToChange(parentId)

    try {
      await serialized(
        this.prisma.client,
        [recipeGraphLock(ctx.organizationId), unitRulesLock(ctx.organizationId)],
        async (tx) => {
          await this.assertComponentUnit(parentId, dto.componentId, dto.unit, tx)
          const [parent, component] = await Promise.all(
            [parentId, dto.componentId].map((id) =>
              tx.recipe.findUniqueOrThrow({
                where: { id },
                select: { name: true, locationId: true },
              }),
            ),
          )
          assertBuiltHere('a recipe', parent.locationId, [component])
          await this.costing.assertEdgeAllowed(ctx.organizationId, parentId, dto.componentId, tx)
          const order = await tx.recipeComponent.count({ where: { parentId } })
          await tx.recipeComponent.create({
            data: {
              parentId,
              componentId: dto.componentId,
              quantity: dto.quantity,
              unit: dto.unit,
              prepNote: dto.prepNote,
              order,
            },
          })
        },
      )
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new BadRequestException({
          code: 'COMPONENT_ALREADY_ADDED',
          message: 'This component is already part of the recipe',
        })
      }
      throw e
    }
    await this.costing.recalcOrganization(ctx.organizationId)
    return this.detail(parentId)
  }

  async updateComponent(parentId: string, componentId: string, dto: UpdateComponentDto) {
    const ctx = requireTenant()
    await this.reachToChange(parentId)
    const { count } = await serialized(
      this.prisma.client,
      unitRulesLock(ctx.organizationId),
      async (tx) => {
        if (dto.unit !== undefined)
          await this.assertComponentUnit(parentId, componentId, dto.unit, tx)
        return tx.recipeComponent.updateMany({
          where: { parentId, componentId, parent: { organizationId: ctx.organizationId } },
          data: {
            ...(dto.quantity === undefined ? {} : { quantity: dto.quantity }),
            ...(dto.unit === undefined ? {} : { unit: dto.unit }),
            ...(dto.prepNote === undefined ? {} : { prepNote: dto.prepNote?.trim() || null }),
          },
        })
      },
    )
    if (count === 0)
      throw new NotFoundException({ code: 'COMPONENT_NOT_FOUND', message: 'Component not found' })
    await this.costing.recalcOrganization(ctx.organizationId)
    return this.detail(parentId)
  }

  async removeComponent(parentId: string, componentId: string) {
    const ctx = requireTenant()
    await this.reachToChange(parentId)
    const { count } = await this.prisma.client.recipeComponent.deleteMany({
      where: { parentId, componentId, parent: { organizationId: ctx.organizationId } },
    })
    if (count === 0)
      throw new NotFoundException({ code: 'COMPONENT_NOT_FOUND', message: 'Component not found' })
    await this.costing.recalcOrganization(ctx.organizationId)
    return this.detail(parentId)
  }
}
