import type { Prisma } from '../../generated/prisma/client'
import { num } from '../../common/utils/decimal'

type SoldLine = {
  quantity: number
  unitPrice: Prisma.Decimal | number
  unitCost: Prisma.Decimal | number
}

export function takings(lines: SoldLine[]) {
  return lines.reduce(
    (total, line) => ({
      sold: total.sold + line.quantity,
      revenue: total.revenue + line.quantity * num(line.unitPrice),
      cost: total.cost + line.quantity * num(line.unitCost),
    }),
    { sold: 0, revenue: 0, cost: 0 },
  )
}
