import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { serialized, type Serial } from '../../common/utils/serialize'
import type { Prisma } from '../../generated/prisma/client'
import {
  acrossLocations,
  changesHere,
  reachedLocations,
  requireTenant,
} from '../../tenancy/tenant-context'
import { nameLock, named, refuseTaken, unitRulesLock } from '../../rules/names'
import { soleLocation } from '../../rules/locations'
import { assertCategoryKind, assertReferencesOwned } from '../../tenancy/references'
import { roleAtLeast } from '../../common/decorators/roles.decorator'
import { money, num, type Numeric } from '../../common/utils/decimal'
import { activeReached, LocationRollup } from './rollup'
import { CostingService, conversionRules } from '../../costing/costing.service'
import { bridgedConversion, dimensionOf, isConvertible, normalizeUnit } from '../../costing/units'
import { costHere, locationSelect, settingsHere, vendorHere } from './pricing'
import { CreateIngredientDto, UpdateIngredientDto } from './dto/ingredients.dto'

export function toContract(i: {
  id: string
  name: string
  unit: string
  costPerUnit: Numeric
  sharedCost?: Numeric
  onHand: Numeric
  reorderLevel: Numeric
  sku?: string | null
  vendorSku?: string | null
  vendorId?: string | null
  categoryId?: string | null
  vendorName?: string | null
  vendor?: { name: string } | null
  category?: { name: string } | null
  locations?: number
  vendors?: number
  costLow?: number | null
  costHigh?: number | null
  isActive?: boolean
  low?: boolean
  lowAt?: string[]
  value?: number
}) {
  const onHand = num(i.onHand)
  const reorderLevel = num(i.reorderLevel)
  return {
    id: i.id,
    name: i.name,
    unit: i.unit,
    costPerUnit: num(i.costPerUnit),
    sharedCostPerUnit: num(i.sharedCost ?? i.costPerUnit),
    onHand,
    reorderLevel,
    vendor: i.vendorName ?? i.vendor?.name ?? '',
    category: i.category?.name ?? 'Uncategorized',
    vendorId: i.vendorId ?? null,
    categoryId: i.categoryId ?? null,
    sku: i.sku ?? '',
    vendorSku: i.vendorSku ?? '',
    locations: i.locations ?? 0,
    vendors: i.vendors ?? 0,
    costLow: i.costLow ?? null,
    costHigh: i.costHigh ?? null,
    status: ((i.low ?? onHand <= reorderLevel) ? 'low' : 'ok') as 'low' | 'ok',
    isActive: i.isActive ?? true,
    lowAt: i.lowAt ?? [],
    value: i.value ?? money(onHand * num(i.costPerUnit)),
  }
}

function overlaid<
  T extends {
    costPerUnit: Numeric
    reorderLevel: Numeric
    vendorId?: string | null
    vendor?: { name: string } | null
    perLocation?: {
      costPerUnit: Numeric
      reorderLevel: Numeric
      vendorId: string | null
      vendorSku: string | null
      vendor?: { name: string } | null
    }[]
  },
>(row: T, onHand: Numeric) {
  const here = row.perLocation?.[0]
  return {
    ...row,
    onHand,
    sharedCost: row.costPerUnit,
    costPerUnit: here?.costPerUnit ?? row.costPerUnit,
    reorderLevel: here?.reorderLevel ?? row.reorderLevel,
    vendorId: here?.vendorId ?? row.vendorId ?? null,
    vendorName: here?.vendor?.name ?? row.vendor?.name ?? null,
    vendorSku: here?.vendorSku ?? null,
  }
}

function definedOnly<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}

// ------------------------------------------------------------------ Service
export function stillHeld(locationId: string | null) {
  const reach = reachedLocations()
  if (locationId) return { stock: { some: { locationId, onHand: { gt: 0 } } } }
  if (reach) return { stock: { some: { locationId: { in: reach }, onHand: { gt: 0 } } } }
  return { OR: [{ onHand: { gt: 0 } }, { stock: { some: { onHand: { gt: 0 } } } }] }
}

function reachedOnly(reach: string[] | null) {
  return reach ? { locationId: { in: reach } } : {}
}

function activeSettings(reach: string[] | null) {
  return { ...reachedOnly(reach), location: { isActive: true } }
}

function shownAt(locationId: string | null, reach: string[] | null) {
  return {
    vendor: { select: { name: true } },
    category: { select: { name: true } },
    stock: locationId
      ? { where: { locationId }, select: { locationId: true, onHand: true } }
      : { where: reachedOnly(reach), select: { locationId: true, onHand: true } },
    perLocation: locationId
      ? settingsHere(locationId)
      : { where: activeSettings(reach), include: { vendor: { select: { name: true } } } },
  } satisfies Prisma.IngredientInclude
}

type ShownRow = Prisma.IngredientGetPayload<{ include: ReturnType<typeof shownAt> }>

@Injectable()
export class IngredientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService,
  ) {}

  async list(includeArchived: boolean | 'held' = false) {
    const ctx = requireTenant()
    const reach = reachedLocations()
    const rows = await this.prisma.client.ingredient.findMany({
      where:
        includeArchived === true
          ? {}
          : includeArchived === 'held'
            ? { OR: [{ isActive: true }, stillHeld(ctx.locationId)] }
            : { isActive: true },
      orderBy: { name: 'asc' },
      include: shownAt(ctx.locationId, reach),
    })
    return this.presented(rows, ctx.locationId, reach)
  }

  private async presented(rows: ShownRow[], locationId: string | null, reach: string[] | null) {
    if (locationId) return rows.map((r) => toContract(overlaid(r, r.stock[0]?.onHand ?? 0)))
    const rollup = await LocationRollup.load(this.prisma, reach)
    return rows.map((r) => toContract(rollup.of(r)))
  }

  private async readOne(id: string, locationId: string | null) {
    const reach = reachedLocations()
    const row = await this.prisma.client.ingredient.findUniqueOrThrow({
      where: { id },
      include: shownAt(locationId, reach),
    })
    return (await this.presented([row], locationId, reach))[0]
  }

  async atLocations(id: string) {
    const ingredient = await this.prisma.client.ingredient.findUnique({
      where: { id },
      include: {
        vendor: { select: { name: true } },
        category: { select: { name: true } },
        stock: true,
        perLocation: { include: { vendor: { select: { name: true } } } },
      },
    })
    if (!ingredient)
      throw new NotFoundException({ code: 'INGREDIENT_NOT_FOUND', message: 'Ingredient not found' })

    const locations = await this.prisma.client.location.findMany({
      where: activeReached(reachedLocations()),
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })

    const rows = locations.map((l) => {
      const own = ingredient.perLocation.find((p) => p.locationId === l.id)
      const stock = ingredient.stock.find((st) => st.locationId === l.id)
      return {
        locationId: l.id,
        location: l.name,
        vendor: own?.vendor?.name ?? ingredient.vendor?.name ?? '',
        vendorId: own?.vendorId ?? ingredient.vendorId ?? null,
        vendorSku: own?.vendorSku ?? '',
        costPerUnit: num(own?.costPerUnit ?? ingredient.costPerUnit),
        reorderLevel: num(own?.reorderLevel ?? ingredient.reorderLevel),
        onHand: num(stock?.onHand ?? 0),
        ownSettings: own !== undefined,
      }
    })

    const costs = rows.map((r) => r.costPerUnit)
    return {
      shared: {
        id: ingredient.id,
        name: ingredient.name,
        unit: ingredient.unit,
        category: ingredient.category?.name ?? 'Uncategorized',
        categoryId: ingredient.categoryId ?? null,
        sku: ingredient.sku ?? '',
        costPerUnit: num(ingredient.costPerUnit),
        reorderLevel: num(ingredient.reorderLevel),
        vendor: ingredient.vendor?.name ?? '',
        vendorId: ingredient.vendorId ?? null,
      },
      locations: rows,
      totals: {
        locations: rows.length,
        vendors: new Set(rows.map((r) => r.vendor).filter(Boolean)).size,
        onHand: rows.reduce((sum, r) => sum + r.onHand, 0),
        costLow: costs.length ? Math.min(...costs) : null,
        costHigh: costs.length ? Math.max(...costs) : null,
      },
    }
  }

  async create(dto: CreateIngredientDto) {
    const ctx = requireTenant()
    this.assertCatalogued(dto.unit)
    await this.assertRefs(dto)
    const { onHand, vendorSku, ...shared } = dto
    if (onHand && !ctx.locationId) {
      throw new BadRequestException({
        code: 'LOCATION_REQUIRED',
        message:
          'Select a location to state an opening balance: stock is held by a location, not by "All locations"',
      })
    }
    const created = await serialized(
      this.prisma.client,
      nameLock('ingredient', ctx.organizationId, dto.name),
      async (tx) => {
        await this.assertNameFree(dto.name, undefined, tx)
        const ingredient = await tx.ingredient.create({
          data: { ...shared, organizationId: ctx.organizationId },
        })
        await this.openHere(tx, ingredient, dto, { onHand, vendorSku })
        return ingredient
      },
    )
    return this.readOne(created.id, ctx.locationId)
  }

  private async openHere(
    tx: Serial,
    created: { id: string; unit: string },
    dto: CreateIngredientDto,
    { onHand, vendorSku }: { onHand?: number; vendorSku?: string },
  ) {
    const ctx = requireTenant()
    if (ctx.locationId) {
      await tx.ingredientLocationSettings.create({
        data: {
          ingredientId: created.id,
          locationId: ctx.locationId,
          costPerUnit: dto.costPerUnit,
          reorderLevel: dto.reorderLevel ?? null,
          vendorId: dto.vendorId ?? null,
          vendorSku: vendorSku ?? null,
        },
      })
    }
    if (ctx.locationId && onHand) {
      const locationId = ctx.locationId
      await tx.inventoryTransaction.create({
        data: {
          organizationId: ctx.organizationId,
          locationId,
          ingredientId: created.id,
          type: 'COUNT',
          quantity: onHand,
          unit: created.unit,
          cost: money(onHand * dto.costPerUnit),
          notes: 'Opening balance',
        },
      })
      await tx.ingredientLocationStock.create({
        data: { ingredientId: created.id, locationId, onHand },
      })
      await tx.ingredient.update({ where: { id: created.id }, data: { onHand } })
    }
  }

  async update(id: string, dto: UpdateIngredientDto) {
    const ctx = requireTenant()
    if (dto.isActive !== undefined && !roleAtLeast(ctx.role, 'manager')) {
      throw new ForbiddenException({
        code: 'ROLE_TOO_LOW',
        message: 'Archiving or restoring an ingredient is for a manager or above',
      })
    }

    const shared = definedOnly({
      name: dto.name,
      unit: dto.unit,
      categoryId: dto.categoryId,
      sku: dto.sku,
      isActive: dto.isActive,
    })
    const perLocation = definedOnly({
      costPerUnit: dto.costPerUnit,
      reorderLevel: dto.reorderLevel,
      vendorId: dto.vendorId,
      vendorSku: dto.vendorSku,
    })

    const existing = await this.prisma.client.ingredient.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        unit: true,
        onHand: true,
        vendorId: true,
        costPerUnit: true,
        perLocation: locationSelect(ctx.locationId),
      },
    })
    if (!existing)
      throw new NotFoundException({ code: 'INGREDIENT_NOT_FOUND', message: 'Ingredient not found' })
    await this.assertRefs(dto, vendorHere(existing))
    if (!ctx.locationId && Object.keys(perLocation).length > 0 && !changesHere(null)) {
      throw new ForbiddenException({
        code: 'LOCATION_REQUIRED',
        message:
          'Choose your location in the header to set its price, vendor or reorder level; the values every location shares are set by someone who works at all of them',
      })
    }
    const unitChanges = dto.unit !== undefined && dto.unit !== existing.unit
    const priceMoved =
      dto.costPerUnit !== undefined && Math.abs(dto.costPerUnit - costHere(existing)) > 1e-9

    let relabelled: string[] = []
    const recost = await serialized(
      this.prisma.client,
      [
        ...nameLock('ingredient', ctx.organizationId, dto.name),
        ...(unitChanges ? [unitRulesLock(ctx.organizationId)] : []),
      ],
      async (tx) => {
        if (unitChanges) relabelled = await this.rebase(id, dto.unit!, tx)
        await this.assertNameFree(dto.name, id, tx)
        if (Object.keys(shared).length > 0) {
          await tx.ingredient.update({ where: { id }, data: shared })
        }

        if (Object.keys(perLocation).length > 0) {
          if (ctx.locationId) {
            await tx.ingredientLocationSettings.upsert({
              where: { ingredientId_locationId: { ingredientId: id, locationId: ctx.locationId } },
              create: { ingredientId: id, locationId: ctx.locationId, ...perLocation },
              update: perLocation,
            })
          } else {
            const organizationWide = definedOnly({
              costPerUnit: dto.costPerUnit,
              reorderLevel: dto.reorderLevel,
              vendorId: dto.vendorId,
            })
            if (Object.keys(organizationWide).length > 0) {
              await tx.ingredient.update({ where: { id }, data: organizationWide })
              const sole = await soleLocation(tx)
              if (sole) {
                await tx.ingredientLocationSettings.updateMany({
                  where: { ingredientId: id, locationId: sole },
                  data: organizationWide,
                })
              }
            }
          }
        }

        if (priceMoved && dto.costPerUnit !== undefined) {
          await tx.ingredientPriceHistory.create({
            data: {
              organizationId: ctx.organizationId,
              ingredientId: id,
              vendorId: dto.vendorId ?? vendorHere(existing),
              locationId: ctx.locationId,
              costPerUnit: dto.costPerUnit,
              source: 'manual',
            },
          })
          const alone = ctx.locationId !== null && (await soleLocation(tx)) === ctx.locationId
          if (alone) {
            await tx.ingredient.update({
              where: { id },
              data: { costPerUnit: dto.costPerUnit },
            })
          }
          return !ctx.locationId || alone
        }
        return false
      },
    )
    if (recost || unitChanges) await this.costing.recalcOrganization(ctx.organizationId)

    const updated = await this.readOne(id, ctx.locationId)
    return unitChanges ? { ...updated, relabelled } : updated
  }

  async remove(id: string) {
    const ingredient = await this.prisma.client.ingredient.findUnique({
      where: { id },
      select: { id: true, onHand: true },
    })
    if (!ingredient)
      throw new NotFoundException({ code: 'INGREDIENT_NOT_FOUND', message: 'Ingredient not found' })
    const records = Object.entries(await this.records(id)).filter(
      ([what]) => what !== 'conversions',
    )
    if (records.some(([, n]) => n > 0) || num(ingredient.onHand) !== 0) {
      throw new BadRequestException({
        code: 'INGREDIENT_IN_USE',
        message:
          'Ingredient has stock, recipes or history on record and cannot be deleted; archive it instead',
      })
    }
    try {
      await this.prisma.client.ingredient.delete({ where: { id } })
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'P2003') {
        throw new BadRequestException({
          code: 'INGREDIENT_IN_USE',
          message: 'Ingredient is used elsewhere and cannot be deleted; archive it instead',
        })
      }
      throw new NotFoundException({ code: 'INGREDIENT_NOT_FOUND', message: 'Ingredient not found' })
    }
    return { ok: true }
  }

  private assertCatalogued(unit: string) {
    if (dimensionOf(unit) === null) {
      throw new BadRequestException({
        code: 'UNIT_NOT_IN_CATALOGUE',
        message: `${unit} is not a unit the catalogue offers; choose a unit from the list`,
      })
    }
  }

  private async rebase(id: string, unit: string, db: Serial): Promise<string[]> {
    this.assertCatalogued(unit)
    const ingredient = await db.ingredient.findUniqueOrThrow({
      where: { id },
      select: { name: true, unit: true, onHand: true, costPerUnit: true },
    })
    const refs = Object.values(await this.records(id, db)).reduce((sum, n) => sum + n, 0)
    if (refs === 0 && num(ingredient.onHand) === 0) return []

    return acrossLocations(async () => {
      const lines = await db.recipeIngredient.findMany({
        where: { ingredientId: id },
        select: { id: true, unit: true, recipe: { select: { name: true } } },
      })
      if (dimensionOf(ingredient.unit) === null) {
        const old = normalizeUnit(ingredient.unit)
        const written = lines.filter((line) => normalizeUnit(line.unit) === old)
        await db.recipeIngredient.updateMany({
          where: { id: { in: written.map((line) => line.id) } },
          data: { unit },
        })
        return [...new Set(written.map((line) => line.recipe.name))].sort()
      }

      const rules = (await conversionRules(db))(id)
      const factor = bridgedConversion(1, ingredient.unit, unit, rules)
      if (factor === null) {
        throw new BadRequestException({
          code: 'INGREDIENT_UNIT_UNREACHED',
          message: `${ingredient.name} is counted in ${ingredient.unit}, and nothing converts it to ${unit}; record a unit conversion first, or create a new ingredient in ${unit}`,
        })
      }
      const stranded = lines.filter((line) => !isConvertible(line.unit, unit, rules))
      if (stranded.length > 0) {
        throw new BadRequestException({
          code: 'INGREDIENT_UNIT_UNREACHED',
          message: `${[...new Set(stranded.map((l) => l.recipe.name))].join(', ')} ${stranded.length === 1 ? 'uses' : 'use'} ${ingredient.name} in a unit that does not convert to ${unit}; record a unit conversion first`,
        })
      }
      const prices = [
        num(ingredient.costPerUnit),
        ...(
          await db.ingredientLocationSettings.findMany({
            where: { ingredientId: id, costPerUnit: { not: null } },
            select: { costPerUnit: true },
          })
        ).map((s) => num(s.costPerUnit)),
      ]
      const lost = prices.some((price) => {
        const exact = price / factor
        return exact > 0 && Math.abs(Math.round(exact * 10_000) / 10_000 - exact) / exact > 0.005
      })
      if (lost) {
        throw new BadRequestException({
          code: 'PRICE_TOO_FINE',
          message: `A price per ${unit} of ${ingredient.name} would be too small to keep exactly; keep a larger unit`,
        })
      }

      await db.ingredient.update({
        where: { id },
        data: {
          onHand: { multiply: factor },
          reorderLevel: { multiply: factor },
          reorderQty: { multiply: factor },
          costPerUnit: { divide: factor },
        },
      })
      await db.ingredientLocationStock.updateMany({
        where: { ingredientId: id },
        data: { onHand: { multiply: factor } },
      })
      await db.ingredientLocationSettings.updateMany({
        where: { ingredientId: id },
        data: { costPerUnit: { divide: factor }, reorderLevel: { multiply: factor } },
      })
      await db.ingredientPriceHistory.updateMany({
        where: { ingredientId: id },
        data: { costPerUnit: { divide: factor } },
      })
      return []
    })
  }

  private async assertNameFree(
    name: string | undefined,
    except: string | undefined,
    db: Pick<Serial, 'ingredient'>,
  ) {
    if (name === undefined) return
    const taken = await db.ingredient.findFirst({
      where: named(name, except),
      select: { name: true },
    })
    if (taken) refuseTaken('ingredient', taken.name)
  }

  private async records(id: string, db: Pick<Serial, 'ingredient'> = this.prisma.client) {
    const counted = await acrossLocations(() =>
      db.ingredient.findUniqueOrThrow({
        where: { id },
        select: {
          _count: {
            select: {
              usedIn: true,
              transactions: true,
              priceHistory: true,
              wasteEntries: true,
              invoiceItems: true,
              draftLines: true,
              conversions: true,
              stock: { where: { onHand: { not: 0 } } },
            },
          },
        },
      }),
    )
    return counted._count
  }

  private async assertRefs(
    dto: { categoryId?: string | null; vendorId?: string | null },
    currentVendor: string | null = null,
  ) {
    await assertReferencesOwned(this.prisma.client, {
      categoryId: dto.categoryId,
      vendorId: dto.vendorId,
    })
    await assertCategoryKind(this.prisma.client, dto.categoryId, 'ingredient')
    if (dto.vendorId && dto.vendorId !== currentVendor) {
      const vendor = await this.prisma.client.vendor.findUnique({
        where: { id: dto.vendorId },
        select: { name: true, status: true },
      })
      if (vendor?.status === 'inactive') {
        throw new BadRequestException({
          code: 'VENDOR_INACTIVE',
          message: `${vendor.name} is inactive; make it active on the Vendors page before it supplies another ingredient`,
        })
      }
    }
  }
}
