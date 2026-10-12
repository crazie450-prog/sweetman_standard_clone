import type { Serial } from '../../common/utils/serialize'

type Received = { id: string; unit: string; vendorId: string | null }

type Shelf = { ingredient: Received; received: number; price: number | null }

export class Delivery {
  private readonly shelves = new Map<string, Shelf>()
  private readonly movements: {
    ingredientId: string
    quantity: number
    unit: string
    cost: number
  }[] = []
  private readonly prices: { ingredientId: string; costPerUnit: number }[] = []

  constructor(
    private readonly organizationId: string,
    private readonly locationId: string,
    private readonly note: string,
    private readonly vendorId: string | null,
    private readonly movesBase: boolean,
  ) {}

  receive(ingredient: Received, received: number, cost: number, price: number | null) {
    const shelf = this.shelves.get(ingredient.id) ?? { ingredient, received: 0, price: null }
    shelf.received += received
    if (price !== null) shelf.price = price
    this.shelves.set(ingredient.id, shelf)
    this.movements.push({
      ingredientId: ingredient.id,
      quantity: received,
      unit: ingredient.unit,
      cost,
    })
    if (price !== null) this.prices.push({ ingredientId: ingredient.id, costPerUnit: price })
  }

  get count() {
    return this.movements.length
  }

  get baseMoved() {
    return this.movesBase && this.prices.length > 0
  }

  async write(tx: Serial) {
    if (this.movements.length === 0) return
    const { organizationId, locationId } = this
    const ids = [...this.shelves.keys()]
    const here = new Map(
      (
        await tx.ingredientLocationSettings.findMany({
          where: { ingredientId: { in: ids }, locationId },
          select: { ingredientId: true, vendorId: true },
        })
      ).map((s) => [s.ingredientId, s.vendorId]),
    )

    await tx.inventoryTransaction.createMany({
      data: this.movements.map((m) => ({
        organizationId,
        locationId,
        type: 'RECEIVE' as const,
        notes: this.note,
        ...m,
      })),
    })
    for (const { ingredient, received, price } of this.shelves.values()) {
      const key = { ingredientId_locationId: { ingredientId: ingredient.id, locationId } }
      await tx.ingredient.update({
        where: { id: ingredient.id },
        data: {
          onHand: { increment: received },
          ...(this.movesBase && price !== null ? { costPerUnit: price } : {}),
        },
      })
      if (price !== null) {
        await tx.ingredientLocationSettings.upsert({
          where: key,
          create: { ingredientId: ingredient.id, locationId, costPerUnit: price },
          update: { costPerUnit: price },
        })
      }
      await tx.ingredientLocationStock.upsert({
        where: key,
        create: { ingredientId: ingredient.id, locationId, onHand: received },
        update: { onHand: { increment: received } },
      })
    }
    if (this.prices.length > 0) {
      const now = Date.now()
      await tx.ingredientPriceHistory.createMany({
        data: this.prices.map((p, order) => ({
          organizationId,
          locationId,
          source: 'receipt',
          recordedAt: new Date(now + order),
          vendorId:
            this.vendorId ??
            here.get(p.ingredientId) ??
            this.shelves.get(p.ingredientId)!.ingredient.vendorId,
          ...p,
        })),
      })
    }
  }
}
