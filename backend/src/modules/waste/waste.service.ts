import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { reachedLocations, requireLocation, requireTenant } from '../../tenancy/tenant-context'
import { money, num } from '../../common/utils/decimal'
import { recordedAt, statedPeriod } from '../../common/utils/calendar'
import { zoneHere } from '../../tenancy/organization-zone'
import { conversionRules } from '../../costing/costing.service'
import { bridgedConversion } from '../../costing/units'
import { takeFromStock } from '../../rules/stock'
import { costHere, locationSelect } from '../ingredients/pricing'
import { stillHeld } from '../ingredients/ingredients.service'
import { WASTE_REASONS } from './reasons'
import { CreateWasteEntryDto } from './dto/waste.dto'
import { pageOf, pageWindow } from '../../common/dto/pagination.dto'
import type { PagedPeriodQuery } from '../../common/dto/period.dto'

@Injectable()
export class WasteService {
  constructor(private readonly prisma: PrismaService) {}

  reasons() {
    return WASTE_REASONS
  }

  async ingredients() {
    const ctx = requireTenant()
    const reach = reachedLocations()
    const rows = await this.prisma.client.ingredient.findMany({
      where: { OR: [{ isActive: true }, stillHeld(ctx.locationId)] },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        unit: true,
        isActive: true,
        costPerUnit: true,
        onHand: true,
        stock: { where: reach ? { locationId: { in: reach } } : {}, select: { onHand: true } },
        perLocation: locationSelect(ctx.locationId),
      },
    })
    return rows.map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      isActive: i.isActive,
      unitCost: costHere(i),
      onHand: reach ? i.stock.reduce((sum, st) => sum + num(st.onHand), 0) : num(i.onHand),
    }))
  }

  async entries(query: PagedPeriodQuery) {
    const where = { date: statedPeriod(query.from, query.to, await zoneHere(this.prisma)) }
    const [rows, total] = await Promise.all([
      this.prisma.client.wasteEntry.findMany({
        where,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
        include: { ingredient: { select: { name: true } } },
      }),
      this.prisma.client.wasteEntry.count({ where }),
    ])
    return pageOf(
      rows.map((w) => ({
        id: w.id,
        ingredient: w.ingredient.name,
        qty: num(w.quantity),
        unit: w.unit,
        reason: WASTE_REASONS.find((r) => r.value === w.reason)?.label ?? w.reason,
        date: w.date.toISOString(),
        value: num(w.value),
      })),
      total,
      query,
    )
  }

  async create(dto: CreateWasteEntryDto) {
    const ctx = requireTenant()
    const locationId = requireLocation()
    const ingredient = await this.prisma.client.ingredient.findUnique({
      where: { id: dto.ingredientId },
      include: { perLocation: locationSelect(locationId) },
    })
    if (!ingredient)
      throw new BadRequestException({ code: 'UNKNOWN_INGREDIENT', message: 'Unknown ingredientId' })

    const quantity = await this.inCountedUnit(dto, ingredient)
    const value = money(quantity * costHere(ingredient))
    const date = recordedAt(dto.date, await zoneHere(this.prisma))

    return this.prisma.client.$transaction(async (tx) => {
      const entry = await tx.wasteEntry.create({
        data: {
          organizationId: ctx.organizationId,
          locationId,
          ingredientId: dto.ingredientId,
          quantity,
          unit: ingredient.unit,
          reason: dto.reason,
          value,
          date,
          notes: dto.notes,
        },
      })
      await tx.inventoryTransaction.create({
        data: {
          organizationId: ctx.organizationId,
          locationId,
          ingredientId: dto.ingredientId,
          type: 'WASTE',
          quantity: -quantity,
          unit: ingredient.unit,
          cost: value,
          wasteReason: dto.reason,
          notes: dto.notes,
          createdAt: date,
        },
      })
      await takeFromStock(tx, {
        organizationId: ctx.organizationId,
        ingredientId: dto.ingredientId,
        locationId,
        quantity,
        name: ingredient.name,
        unit: ingredient.unit,
      })
      return entry
    })
  }

  private async inCountedUnit(
    dto: CreateWasteEntryDto,
    ingredient: { id: string; name: string; unit: string },
  ) {
    const stated = Math.abs(dto.quantity)
    if (!dto.unit) return stated
    const rules = await conversionRules(this.prisma.client)
    const converted = bridgedConversion(stated, dto.unit, ingredient.unit, rules(ingredient.id))
    if (converted === null) {
      throw new BadRequestException({
        code: 'UNIT_NOT_CONVERTIBLE',
        message: `${ingredient.name} is counted in ${ingredient.unit}, and ${dto.unit} does not convert to it`,
      })
    }
    return converted
  }
}
