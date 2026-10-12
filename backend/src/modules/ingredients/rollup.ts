import { money, num, type Numeric } from '../../common/utils/decimal'
import type { PrismaService } from '../../prisma/prisma.service'

type Held = { locationId?: string; onHand: Numeric }

type OwnSettings = {
  locationId?: string
  costPerUnit: Numeric
  reorderLevel: Numeric
  vendorId: string | null
}

type SharedRow = {
  costPerUnit: Numeric
  reorderLevel: Numeric
  vendorId?: string | null
  stock: Held[]
  perLocation?: OwnSettings[]
}

export function activeReached(reach: string[] | null) {
  return { isActive: true, ...(reach ? { id: { in: reach } } : {}) }
}

export class LocationRollup {
  private constructor(
    private readonly locations: readonly { id: string; name: string }[],
    private readonly reach: string[] | null,
  ) {}

  static async load(prisma: PrismaService, reach: string[] | null) {
    const open = await prisma.client.location.findMany({
      where: activeReached(reach),
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })
    return new LocationRollup(open, reach)
  }

  of<T extends SharedRow>(row: T) {
    const own = row.perLocation ?? []
    const costs = own.filter((p) => p.costPerUnit !== null).map((p) => num(p.costPerUnit))
    const vendors = new Set(own.map((p) => p.vendorId).filter((v): v is string => v !== null))
    if (own.length < this.locations.length || own.some((p) => p.costPerUnit === null)) {
      costs.push(num(row.costPerUnit))
      if (row.vendorId) vendors.add(row.vendorId)
    }
    const lowAt = this.lowAt(row, own)
    return {
      ...row,
      ...(this.reach ? { onHand: this.held(row.stock) } : {}),
      locations: this.locations.length,
      vendors: vendors.size,
      costLow: costs.length ? Math.min(...costs) : null,
      costHigh: costs.length ? Math.max(...costs) : null,
      lowAt,
      value: this.value(row, own),
      low: this.locations.length > 0 ? lowAt.length > 0 : undefined,
    }
  }

  private held(stock: Held[], locationId?: string) {
    return stock
      .filter((s) => locationId === undefined || s.locationId === locationId)
      .reduce((sum, s) => sum + num(s.onHand), 0)
  }

  private value(row: SharedRow, own: OwnSettings[]) {
    const prices = new Map(own.map((p) => [p.locationId, p.costPerUnit] as const))
    return money(
      this.locations.reduce(
        (sum, l) => sum + this.held(row.stock, l.id) * num(prices.get(l.id) ?? row.costPerUnit),
        0,
      ),
    )
  }

  private lowAt(row: SharedRow, own: OwnSettings[]) {
    const levels = new Map(own.map((p) => [p.locationId, p.reorderLevel] as const))
    return this.locations
      .filter((l) => this.held(row.stock, l.id) <= num(levels.get(l.id) ?? row.reorderLevel))
      .map((l) => l.name)
  }
}
