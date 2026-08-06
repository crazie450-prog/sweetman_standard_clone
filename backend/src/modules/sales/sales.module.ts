import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
} from '@nestjs/common'
import {
  ApiCookieAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator'
import { PrismaService } from '../../prisma/prisma.service'
import { requireLocation, requireTenant } from '../../tenancy/tenant-context'
import { Roles } from '../../common/decorators/roles.decorator'
import { money, num } from '../../common/utils/decimal'
import { weekStartKey } from '../../common/utils/calendar'

export class SaleItemInput {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  menuItemId!: string

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number
}

export class CreateSaleDto {
  @ApiPropertyOptional({ description: 'ISO date; empty = now' })
  @IsOptional()
  @IsISO8601()
  date?: string

  @ApiProperty({ type: [SaleItemInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleItemInput)
  items!: SaleItemInput[]
}

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  async daily() {
    const rows = await this.prisma.client.sale.findMany({
      orderBy: { date: 'desc' },
      take: 90,
      include: { items: true },
    })
    const byDay = new Map<string, { sales: number; revenue: number; cost: number }>()
    for (const s of rows) {
      const key = s.date.toISOString().slice(0, 10)
      const cur = byDay.get(key) ?? { sales: 0, revenue: 0, cost: 0 }
      for (const it of s.items) {
        cur.sales += it.quantity
        cur.revenue += it.quantity * num(it.unitPrice)
        cur.cost += it.quantity * num(it.unitCost)
      }
      byDay.set(key, cur)
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, v]) => ({
        date,
        sales: v.sales,
        revenue: money(v.revenue),
        cost: money(v.cost),
        profit: money(v.revenue - v.cost),
      }))
  }

  async individual() {
    const rows = await this.prisma.client.sale.findMany({
      orderBy: { date: 'desc' },
      take: 50,
      include: { items: { include: { menuItem: { select: { name: true } } } } },
    })
    return rows.flatMap((s) =>
      s.items.map((it) => ({
        id: it.id,
        item: it.menuItem.name,
        qty: it.quantity,
        price: num(it.unitPrice),
        date: s.date.toISOString().slice(0, 10),
      })),
    )
  }

  async menuItemNames() {
    const rows = await this.prisma.client.menuItem.findMany({
      where: { isActive: true },
      select: { name: true },
      orderBy: { name: 'asc' },
    })
    return rows.map((r) => r.name)
  }

  async summary() {
    const rows = await this.prisma.client.sale.findMany({
      orderBy: { date: 'desc' },
      take: 500,
      include: { items: { include: { menuItem: { select: { name: true } } } } },
    })
    const acc = new Map<string, { item: string; qty: number; gross: number; period: string }>()
    for (const s of rows) {
      const period = weekStartKey(s.date)
      for (const it of s.items) {
        const key = `${period}|${it.menuItem.name}`
        const cur = acc.get(key) ?? { item: it.menuItem.name, qty: 0, gross: 0, period }
        cur.qty += it.quantity
        cur.gross += it.quantity * num(it.unitPrice)
        acc.set(key, cur)
      }
    }
    return [...acc.entries()].map(([id, r]) => ({ id, ...r, gross: money(r.gross) }))
  }

  async create(dto: CreateSaleDto) {
    const ctx = requireTenant()
    const locationId = requireLocation()
    const ids = [...new Set(dto.items.map((i) => i.menuItemId))]
    const menuItems = await this.prisma.client.menuItem.findMany({
      where: { id: { in: ids } },
      include: {
        recipes: {
          include: { recipe: { select: { totalCost: true, portions: true } } },
        },
      },
    })
    if (menuItems.length !== ids.length) throw new BadRequestException('Unknown menuItemId')
    const byId = new Map(menuItems.map((m) => [m.id, m]))

    return this.prisma.client.sale.create({
      data: {
        organizationId: ctx.organizationId,
        locationId,
        date: dto.date ? new Date(dto.date) : new Date(),
        items: {
          create: dto.items.map((i) => {
            const m = byId.get(i.menuItemId)!
            const unitCost = m.recipes.reduce(
              (sum, r) =>
                sum + (num(r.recipe.totalCost) / Math.max(1, r.recipe.portions)) * num(r.portions),
              0,
            )
            return {
              menuItemId: i.menuItemId,
              quantity: i.quantity,
              unitPrice: num(m.price),
              unitCost: money(unitCost),
            }
          }),
        },
      },
      include: { items: true },
    })
  }
}

@ApiTags('sales')
@ApiCookieAuth()
@Controller('api/sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('daily')
  @ApiOperation({ summary: 'Daily sales' })
  daily() {
    return this.sales.daily()
  }

  @Get()
  @ApiOperation({ summary: 'Individual sold items' })
  individual() {
    return this.sales.individual()
  }

  @Get('menu-items')
  @ApiOperation({ summary: 'Menu item names (filter source)' })
  menuItemNames() {
    return this.sales.menuItemNames()
  }

  @Get('summary')
  @ApiOperation({ summary: 'Weekly summary' })
  summary() {
    return this.sales.summary()
  }

  @Post()
  @Roles('staff')
  @ApiOperation({ summary: 'Record a sale: price and cost are stored as a point-in-time snapshot' })
  create(@Body() dto: CreateSaleDto) {
    return this.sales.create(dto)
  }
}

@Module({
  providers: [SalesService],
  controllers: [SalesController],
  exports: [SalesService],
})
export class SalesModule {}
