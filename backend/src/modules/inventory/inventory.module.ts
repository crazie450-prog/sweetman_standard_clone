import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import {
  ApiCookieAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator'
import { PrismaService } from '../../prisma/prisma.service'
import { requireLocation, requireTenant } from '../../tenancy/tenant-context'
import { Roles } from '../../common/decorators/roles.decorator'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { money, num } from '../../common/utils/decimal'
import { weekStartKey } from '../../common/utils/calendar'
import { IngredientsModule, IngredientsService } from '../ingredients/ingredients.module'
import type { Prisma, TxType } from '../../generated/prisma/client'

const TX_TYPES = ['RECEIVE', 'USE', 'ADJUST', 'WASTE', 'COUNT'] as const

export class CreateTransactionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  ingredientId!: string

  @ApiProperty({ enum: TX_TYPES })
  @IsIn(TX_TYPES as unknown as string[])
  type!: Exclude<TxType, 'SALE'>

  @ApiProperty({ description: '+ received, − consumed; COUNT sets the absolute on-hand value' })
  @Type(() => Number)
  @IsNumber()
  quantity!: number

  @ApiPropertyOptional({ description: 'Transaction value; empty = qty × costPerUnit' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  cost?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string

  @ApiPropertyOptional({ description: 'Required when type=WASTE' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  wasteReason?: string
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  private txType = (type: TxType, quantity: number): 'received' | 'used' | 'wasted' => {
    if (type === 'RECEIVE') return 'received'
    if (type === 'WASTE') return 'wasted'
    if (type === 'USE' || type === 'SALE') return 'used'
    return quantity >= 0 ? 'received' : 'used'
  }

  async transactions(page: PaginationDto) {
    const rows = await this.prisma.client.inventoryTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      skip: page.skip,
      take: page.limit,
      include: {
        ingredient: { select: { name: true, category: { select: { name: true } } } },
      },
    })
    return rows.map((t) => ({
      id: t.id,
      date: t.createdAt.toISOString(),
      type: this.txType(t.type, num(t.quantity)),
      ingredient: t.ingredient.name,
      category: t.ingredient.category?.name ?? '',
      quantity: Math.abs(num(t.quantity)),
      unit: t.unit,
      cost: num(t.cost),
      notes: t.notes ?? '',
    }))
  }

  async createTransaction(dto: CreateTransactionDto) {
    const ctx = requireTenant()
    const locationId = requireLocation()
    if (dto.type === 'WASTE' && !dto.wasteReason) {
      throw new BadRequestException('wasteReason is required for WASTE transactions')
    }
    const ingredient = await this.prisma.client.ingredient.findUnique({
      where: { id: dto.ingredientId },
    })
    if (!ingredient) throw new BadRequestException('Unknown ingredientId')

    const signed =
      dto.type === 'RECEIVE'
        ? Math.abs(dto.quantity)
        : dto.type === 'USE' || dto.type === 'WASTE'
          ? -Math.abs(dto.quantity)
          : dto.quantity

    const cost = dto.cost ?? money(Math.abs(dto.quantity) * num(ingredient.costPerUnit))

    const writes: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.client.inventoryTransaction.create({
        data: {
          organizationId: ctx.organizationId,
          locationId,
          ingredientId: dto.ingredientId,
          type: dto.type,
          quantity: dto.type === 'COUNT' ? dto.quantity : signed,
          unit: ingredient.unit,
          cost,
          notes: dto.notes,
          wasteReason: dto.wasteReason,
        },
      }),
      this.prisma.client.ingredient.update({
        where: { id: dto.ingredientId },
        data: dto.type === 'COUNT' ? { onHand: dto.quantity } : { onHand: { increment: signed } },
      }),
    ]
    writes.push(
      this.prisma.client.ingredientLocationStock.upsert({
        where: { ingredientId_locationId: { ingredientId: dto.ingredientId, locationId } },
        create: {
          ingredientId: dto.ingredientId,
          locationId,
          onHand: dto.type === 'COUNT' ? dto.quantity : signed,
        },
        update: dto.type === 'COUNT' ? { onHand: dto.quantity } : { onHand: { increment: signed } },
      }),
    )
    if (dto.type === 'RECEIVE' && dto.cost !== undefined && Math.abs(dto.quantity) > 0) {
      writes.push(
        this.prisma.client.ingredientPriceHistory.create({
          data: {
            organizationId: ctx.organizationId,
            ingredientId: dto.ingredientId,
            vendorId: ingredient.vendorId,
            locationId,
            costPerUnit: money(dto.cost / Math.abs(dto.quantity)),
            source: 'receipt',
          },
        }),
      )
    }

    const [tx] = await this.prisma.client.$transaction(writes)
    return tx
  }

  async usage() {
    const rows = await this.prisma.client.inventoryTransaction.findMany({
      where: { type: 'USE' },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        ingredient: { select: { name: true, category: { select: { name: true } } } },
      },
    })
    const acc = new Map<
      string,
      {
        period: string
        ingredient: string
        category: string
        used: number
        unit: string
        cost: number
      }
    >()
    for (const t of rows) {
      const period = weekStartKey(t.createdAt)
      const key = `${period}|${t.ingredient.name}`
      const cur = acc.get(key) ?? {
        period,
        ingredient: t.ingredient.name,
        category: t.ingredient.category?.name ?? '',
        used: 0,
        unit: t.unit,
        cost: 0,
      }
      cur.used += Math.abs(num(t.quantity))
      cur.cost += num(t.cost)
      acc.set(key, cur)
    }
    return [...acc.entries()].map(([key, r]) => ({
      id: key,
      period: r.period,
      ingredient: r.ingredient,
      category: r.category,
      used: Math.round(r.used * 100) / 100,
      unit: r.unit,
      cost: money(r.cost),
    }))
  }

  async priceTrends() {
    const ingredients = await this.prisma.client.ingredient.findMany({
      include: {
        vendor: { select: { name: true } },
        priceHistory: { orderBy: { recordedAt: 'desc' }, take: 2 },
      },
    })
    return ingredients
      .filter((i) => i.priceHistory.length > 0)
      .map((i) => {
        const current = num(i.priceHistory[0].costPerUnit)
        const previous = num((i.priceHistory[1] ?? i.priceHistory[0]).costPerUnit)
        const change = previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : 0
        return {
          id: i.id,
          ingredient: i.name,
          vendor: i.vendor?.name ?? '',
          previous,
          current,
          change,
        }
      })
  }

  async priceHistory(ingredientId: string) {
    const ingredient = await this.prisma.client.ingredient.findFirst({
      where: { id: ingredientId },
      select: { id: true, name: true, unit: true },
    })
    if (!ingredient) throw new NotFoundException('Ingredient not found')

    const rows = await this.prisma.client.ingredientPriceHistory.findMany({
      where: { ingredientId },
      orderBy: { recordedAt: 'desc' },
      take: 200,
      include: {
        vendor: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
    })
    return {
      ingredient,
      records: rows.map((r) => ({
        id: r.id,
        costPerUnit: num(r.costPerUnit),
        source: r.source,
        recordedAt: r.recordedAt.toISOString(),
        vendor: r.vendor?.name ?? '',
        vendorId: r.vendorId,
        location: r.location?.name ?? '',
        locationId: r.locationId,
      })),
    }
  }
}

@ApiTags('inventory')
@ApiCookieAuth()
@Controller('api')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly ingredients: IngredientsService,
  ) {}

  @Get('inventory')
  @ApiOperation({ summary: 'Inventory items (the same entity as ingredients)' })
  list() {
    return this.ingredients.list()
  }

  @Get('inventory/transactions')
  @ApiOperation({ summary: 'Inventory transactions (quantity as a number, unit separate)' })
  transactions(@Query() page: PaginationDto) {
    return this.inventory.transactions(page)
  }

  @Post('inventory/transactions')
  @Roles('staff')
  @ApiOperation({ summary: 'Inventory movement: updates onHand atomically' })
  createTransaction(@Body() dto: CreateTransactionDto) {
    return this.inventory.createTransaction(dto)
  }

  @Get('reports/usage')
  @ApiOperation({ summary: 'Weekly consumption' })
  usage() {
    return this.inventory.usage()
  }

  @Get('reports/price-trends')
  @ApiOperation({ summary: 'Price trends: the latest recorded price against the previous one' })
  priceTrends() {
    return this.inventory.priceTrends()
  }

  @Get('ingredients/:id/price-history')
  @ApiOperation({ summary: 'Ingredient price history with vendor and location' })
  priceHistory(@Param('id') id: string) {
    return this.inventory.priceHistory(id)
  }
}

@Module({
  imports: [IngredientsModule],
  providers: [InventoryService],
  controllers: [InventoryController],
  exports: [InventoryService],
})
export class InventoryModule {}
