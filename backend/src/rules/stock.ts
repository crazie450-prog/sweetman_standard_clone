import { BadRequestException } from '@nestjs/common'
import type { TenantScopedClient } from '../prisma/prisma.service'
import { num } from '../common/utils/decimal'

export type StockWriter = Pick<TenantScopedClient, 'ingredient' | 'ingredientLocationStock'>

export interface StockDraw {
  organizationId: string
  ingredientId: string
  locationId: string
  quantity: number
  name: string
  unit: string
}

export async function takeFromStock(tx: StockWriter, draw: StockDraw): Promise<void> {
  const taken = Math.abs(draw.quantity)
  const { count } = await tx.ingredientLocationStock.updateMany({
    where: {
      ingredientId: draw.ingredientId,
      locationId: draw.locationId,
      onHand: { gte: taken },
      ingredient: { organizationId: draw.organizationId },
    },
    data: { onHand: { decrement: taken } },
  })
  if (count === 0) {
    const held = await tx.ingredientLocationStock.findUnique({
      where: {
        ingredientId_locationId: { ingredientId: draw.ingredientId, locationId: draw.locationId },
      },
      select: { onHand: true },
    })
    throw new BadRequestException({
      code: 'STOCK_TOO_LOW',
      message: `Only ${num(held?.onHand ?? 0)} ${draw.unit} of ${draw.name} is in stock at this location`,
    })
  }
  await tx.ingredient.update({
    where: { id: draw.ingredientId },
    data: { onHand: { decrement: taken } },
  })
}
