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
import { IsIn, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator'
import { PrismaService } from '../../prisma/prisma.service'
import { requireLocation, requireTenant } from '../../tenancy/tenant-context'
import { Roles } from '../../common/decorators/roles.decorator'
import { money, num } from '../../common/utils/decimal'
import type { Prisma } from '../../generated/prisma/client'

const WASTE_REASONS = [
  { value: 'spoilage', label: 'Spoilage' },
  { value: 'overproduction', label: 'Overproduction' },
  { value: 'trim', label: 'Trim waste' },
  { value: 'expired', label: 'Expired' },
  { value: 'other', label: 'Other' },
] as const

export class CreateWasteEntryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  ingredientId!: string

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number

  @ApiProperty({ enum: WASTE_REASONS.map((r) => r.value) })
  @IsIn(WASTE_REASONS.map((r) => r.value))
  reason!: string

  @ApiPropertyOptional({ description: 'ISO date; empty = now' })
  @IsOptional()
  @IsISO8601()
  date?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string
}

@Injectable()
export class WasteService {
  constructor(private readonly prisma: PrismaService) {}

  reasons() {
    return WASTE_REASONS
  }

  async ingredients() {
    const rows = await this.prisma.client.ingredient.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, unit: true, costPerUnit: true },
    })
    return rows.map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      unitCost: num(i.costPerUnit),
    }))
  }

  async entries() {
    const rows = await this.prisma.client.wasteEntry.findMany({
      orderBy: { date: 'desc' },
      take: 500,
      include: { ingredient: { select: { name: true } } },
    })
    return rows.map((w) => ({
      id: w.id,
      ingredient: w.ingredient.name,
      qty: num(w.quantity),
      unit: w.unit,
      reason: WASTE_REASONS.find((r) => r.value === w.reason)?.label ?? w.reason,
      date: w.date.toISOString(),
      value: num(w.value),
    }))
  }

  async create(dto: CreateWasteEntryDto) {
    const ctx = requireTenant()
    const locationId = requireLocation()
    const ingredient = await this.prisma.client.ingredient.findUnique({
      where: { id: dto.ingredientId },
    })
    if (!ingredient) throw new BadRequestException('Unknown ingredientId')

    const value = money(dto.quantity * num(ingredient.costPerUnit))
    const date = dto.date ? new Date(dto.date) : new Date()

    const writes: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.client.wasteEntry.create({
        data: {
          organizationId: ctx.organizationId,
          locationId,
          ingredientId: dto.ingredientId,
          quantity: dto.quantity,
          unit: ingredient.unit,
          reason: dto.reason,
          value,
          date,
          notes: dto.notes,
        },
      }),
      this.prisma.client.inventoryTransaction.create({
        data: {
          organizationId: ctx.organizationId,
          locationId,
          ingredientId: dto.ingredientId,
          type: 'WASTE',
          quantity: -Math.abs(dto.quantity),
          unit: ingredient.unit,
          cost: value,
          wasteReason: dto.reason,
          notes: dto.notes,
        },
      }),
      this.prisma.client.ingredient.update({
        where: { id: dto.ingredientId },
        data: { onHand: { decrement: dto.quantity } },
      }),
    ]
    writes.push(
      this.prisma.client.ingredientLocationStock.upsert({
        where: { ingredientId_locationId: { ingredientId: dto.ingredientId, locationId } },
        create: {
          ingredientId: dto.ingredientId,
          locationId,
          onHand: -Math.abs(dto.quantity),
        },
        update: { onHand: { decrement: Math.abs(dto.quantity) } },
      }),
    )

    const [entry] = await this.prisma.client.$transaction(writes)
    return entry
  }
}

@ApiTags('waste')
@ApiCookieAuth()
@Controller('api/waste')
export class WasteController {
  constructor(private readonly waste: WasteService) {}

  @Get()
  @ApiOperation({ summary: 'Waste entries' })
  entries() {
    return this.waste.entries()
  }

  @Get('records')
  @ApiOperation({ summary: 'Alias of /entries' })
  records() {
    return this.waste.entries()
  }

  @Get('ingredients')
  @ApiOperation({ summary: 'Ingredients available to the waste form' })
  ingredients() {
    return this.waste.ingredients()
  }

  @Get('reasons')
  @ApiOperation({ summary: 'Waste reason reference list' })
  reasons() {
    return this.waste.reasons()
  }

  @Post()
  @Roles('staff')
  @ApiOperation({
    summary: 'Waste: writes the entry, the WASTE transaction and the onHand update in one step',
  })
  create(@Body() dto: CreateWasteEntryDto) {
    return this.waste.create(dto)
  }
}

@Module({
  providers: [WasteService],
  controllers: [WasteController],
})
export class WasteModule {}
