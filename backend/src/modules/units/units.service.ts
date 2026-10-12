import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { notFoundOr } from '../../common/utils/missing'
import { lockKey, serialized, type Serial } from '../../common/utils/serialize'
import { acrossLocations, requireTenant } from '../../tenancy/tenant-context'
import { assertReferencesOwned } from '../../tenancy/references'
import { num, type Numeric } from '../../common/utils/decimal'
import { CostingService } from '../../costing/costing.service'
import {
  bridgedConversion,
  dimensionOf,
  normalizeUnit,
  type IngredientConversion,
} from '../../costing/units'
import { isPortionUnit } from '../../rules/recipes'
import { unitRulesLock } from '../../rules/names'
import { CreateUnitConversionDto, UpdateUnitConversionDto } from './dto/units.dto'

/* ===== Service ===== */

const RULE_INCLUDE = {
  ingredient: { select: { name: true } },
  recipe: { select: { name: true } },
} as const

function ruleContract(r: {
  id: string
  ingredientId: string | null
  ingredient: { name: string } | null
  recipeId: string | null
  recipe: { name: string } | null
  fromUnit: string
  toUnit: string
  factor: Numeric
}) {
  return {
    id: r.id,
    ingredientId: r.ingredientId,
    ingredient: r.ingredient?.name ?? '',
    recipeId: r.recipeId,
    recipe: r.recipe?.name ?? '',
    fromUnit: r.fromUnit,
    toUnit: r.toUnit,
    factor: num(r.factor),
  }
}

type Scope = { ingredientId: string | null; recipeId: string | null }

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService,
  ) {}

  async list() {
    const rows = await this.prisma.client.unitConversion.findMany({
      orderBy: [{ recipeId: 'asc' }, { ingredientId: 'asc' }, { fromUnit: 'asc' }],
      include: RULE_INCLUDE,
    })
    return rows.map(ruleContract)
  }

  private async readOne(id: string) {
    const row = await this.prisma.client.unitConversion.findUniqueOrThrow({
      where: { id },
      include: RULE_INCLUDE,
    })
    return ruleContract(row)
  }

  async create(dto: CreateUnitConversionDto) {
    const ctx = requireTenant()
    const { fromUnit, toUnit } = this.assertUsable(dto.fromUnit, dto.toUnit)
    await assertReferencesOwned(this.prisma.client, {
      ingredientId: dto.ingredientId,
      recipeId: dto.recipeId,
    })
    const scope = { ingredientId: dto.ingredientId ?? null, recipeId: dto.recipeId ?? null }
    const created = await serialized(
      this.prisma.client,
      lockKey(
        'unit-conversion',
        ctx.organizationId,
        scope.recipeId ?? '',
        scope.ingredientId ?? '',
        ...[fromUnit, toUnit].sort(),
      ),
      async (tx) => {
        await this.assertUnclaimed(scope, fromUnit, toUnit, undefined, tx)
        return tx.unitConversion
          .create({
            data: {
              organizationId: ctx.organizationId,
              ...scope,
              fromUnit,
              toUnit,
              factor: dto.factor,
            },
          })
          .catch(() => {
            throw new BadRequestException({
              code: 'CONVERSION_ALREADY_RECORDED',
              message: 'That conversion is already recorded',
            })
          })
      },
    )

    await this.costing.recalcOrganization(ctx.organizationId)
    return this.readOne(created.id)
  }

  async update(id: string, dto: UpdateUnitConversionDto) {
    const ctx = requireTenant()
    const current = await this.prisma.client.unitConversion.findUnique({ where: { id } })
    if (!current)
      throw new NotFoundException({ code: 'CONVERSION_NOT_FOUND', message: 'Conversion not found' })

    const { fromUnit, toUnit } = this.assertUsable(
      dto.fromUnit ?? current.fromUnit,
      dto.toUnit ?? current.toUnit,
      [dto.fromUnit, dto.toUnit].filter((unit): unit is string => unit !== undefined),
    )
    await assertReferencesOwned(this.prisma.client, {
      ingredientId: dto.ingredientId,
      recipeId: dto.recipeId,
    })
    const scope = {
      ingredientId:
        dto.ingredientId === undefined ? current.ingredientId : (dto.ingredientId ?? null),
      recipeId: dto.recipeId === undefined ? current.recipeId : (dto.recipeId ?? null),
    }

    await serialized(
      this.prisma.client,
      [
        lockKey(
          'unit-conversion',
          ctx.organizationId,
          scope.recipeId ?? '',
          scope.ingredientId ?? '',
          ...[fromUnit, toUnit].sort(),
        ),
        unitRulesLock(ctx.organizationId),
      ],
      async (tx) => {
        await this.assertLinesStillReached(
          id,
          { ...scope, fromUnit, toUnit, factor: dto.factor ?? num(current.factor) },
          tx,
        )
        await this.assertUnclaimed(scope, fromUnit, toUnit, id, tx)
        await tx.unitConversion.update({
          where: { id },
          data: {
            ...scope,
            fromUnit,
            toUnit,
            ...(dto.factor === undefined ? {} : { factor: dto.factor }),
          },
        })
      },
    )
    await this.costing.recalcOrganization(ctx.organizationId)
    return this.readOne(id)
  }

  async remove(id: string) {
    const ctx = requireTenant()
    await serialized(this.prisma.client, unitRulesLock(ctx.organizationId), async (tx) => {
      await this.assertLinesStillReached(id, null, tx)
      try {
        await tx.unitConversion.delete({ where: { id } })
      } catch (e) {
        throw notFoundOr(e, 'Conversion not found')
      }
    })
    await this.costing.recalcOrganization(ctx.organizationId)
    return { ok: true }
  }

  private async assertLinesStillReached(
    id: string,
    replacement: (IngredientConversion & Scope) | null,
    db: Serial,
  ) {
    const [rules, lines, shares] = await Promise.all([
      db.unitConversion.findMany({
        select: {
          id: true,
          ingredientId: true,
          recipeId: true,
          fromUnit: true,
          toUnit: true,
          factor: true,
        },
      }),
      acrossLocations(() =>
        db.recipeIngredient.findMany({
          where: { recipe: { organizationId: requireTenant().organizationId } },
          select: {
            unit: true,
            ingredientId: true,
            recipeId: true,
            ingredient: { select: { unit: true } },
            recipe: { select: { name: true } },
          },
        }),
      ),
      acrossLocations(() =>
        db.recipeComponent.findMany({
          where: { parent: { organizationId: requireTenant().organizationId } },
          select: {
            unit: true,
            parentId: true,
            componentId: true,
            parent: { select: { name: true } },
            component: { select: { yieldAmount: true, yieldUnit: true } },
          },
        }),
      ),
    ])
    const plain = rules.map((r) => ({
      id: r.id,
      ingredientId: r.ingredientId,
      recipeId: r.recipeId,
      fromUnit: r.fromUnit,
      toUnit: r.toUnit,
      factor: num(r.factor),
    }))
    const next = [
      ...plain.filter((r) => r.id !== id),
      ...(replacement ? [{ ...replacement, id }] : []),
    ]
    const rulesFor = (set: typeof plain, ingredientId: string, recipeId: string) =>
      set.filter(
        (r) =>
          (r.recipeId === null || r.recipeId === recipeId) &&
          (r.ingredientId === null || r.ingredientId === ingredientId),
      )
    const stranded = lines.filter(
      (l) =>
        bridgedConversion(
          1,
          l.unit,
          l.ingredient.unit,
          rulesFor(plain, l.ingredientId, l.recipeId),
        ) !== null &&
        bridgedConversion(
          1,
          l.unit,
          l.ingredient.unit,
          rulesFor(next, l.ingredientId, l.recipeId),
        ) === null,
    )
    const measuring = (set: typeof plain, parentId: string, componentId: string) =>
      set.filter(
        (r) =>
          r.ingredientId === null &&
          (r.recipeId === null || r.recipeId === parentId || r.recipeId === componentId),
      )
    const measured = shares.filter(
      (c) =>
        !isPortionUnit(c.unit) &&
        c.component.yieldUnit !== null &&
        c.component.yieldAmount !== null &&
        bridgedConversion(
          1,
          c.unit,
          c.component.yieldUnit,
          measuring(plain, c.parentId, c.componentId),
        ) !== null &&
        bridgedConversion(
          1,
          c.unit,
          c.component.yieldUnit,
          measuring(next, c.parentId, c.componentId),
        ) === null,
    )
    const names = [
      ...new Set([...stranded.map((l) => l.recipe.name), ...measured.map((c) => c.parent.name)]),
    ]
    if (names.length) {
      throw new BadRequestException({
        code: 'CONVERSION_IN_USE',
        message: `${names.join(', ')} ${names.length === 1 ? 'states' : 'state'} an ingredient or a nested recipe in a unit only this rule converts; change those lines first`,
      })
    }
  }

  private async assertUnclaimed(
    scope: Scope,
    fromUnit: string,
    toUnit: string,
    exceptId: string | undefined,
    db: Pick<Serial, 'unitConversion'>,
  ) {
    const clash = await db.unitConversion.findFirst({
      where: {
        ...scope,
        OR: [
          { fromUnit, toUnit },
          { fromUnit: toUnit, toUnit: fromUnit },
        ],
        ...(exceptId === undefined ? {} : { NOT: { id: exceptId } }),
      },
      select: { id: true },
    })
    if (clash) {
      throw new BadRequestException({
        code: 'CONVERSION_ALREADY_RECORDED',
        message: 'That conversion is already recorded',
      })
    }
  }

  private assertUsable(from: string, to: string, chosen: string[] = [from, to]) {
    const fromUnit = normalizeUnit(from)
    const toUnit = normalizeUnit(to)
    const unknown = chosen.map(normalizeUnit).filter((unit) => dimensionOf(unit) === null)
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: 'UNIT_NOT_IN_CATALOGUE',
        message: `${unknown.join(' and ')} ${unknown.length === 1 ? 'is' : 'are'} not a unit the catalogue offers; choose units from the list`,
      })
    }
    if (fromUnit === toUnit) {
      throw new BadRequestException({
        code: 'CONVERSION_UNITS_SAME',
        message: 'A conversion needs two different units',
      })
    }
    if (dimensionOf(fromUnit) !== null && dimensionOf(fromUnit) === dimensionOf(toUnit)) {
      throw new BadRequestException({
        code: 'CONVERSION_NOT_NEEDED',
        message: `${fromUnit} and ${toUnit} already convert into one another without a rule`,
      })
    }
    return { fromUnit, toUnit }
  }
}
