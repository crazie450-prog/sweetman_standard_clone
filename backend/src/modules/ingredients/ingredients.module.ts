import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import {
  ApiCookieAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  OmitType,
  PartialType,
} from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { PrismaService } from '../../prisma/prisma.service'
import { requireTenant } from '../../tenancy/tenant-context'
import { Roles } from '../../common/decorators/roles.decorator'
import { num } from '../../common/utils/decimal'
import { CostingModule, CostingService } from '../../costing/costing.service'

// ---------------------------------------------------------------------- DTO
export class CreateIngredientDto {
  @ApiProperty({ example: 'Beef Tenderloin' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string

  @ApiProperty({ example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  unit!: string

  @ApiProperty({ example: 38.5, minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPerUnit!: number

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  onHand?: number

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  reorderLevel?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendorId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string
}
export class UpdateIngredientDto extends PartialType(OmitType(CreateIngredientDto, ['onHand'])) {}

export function toContract(i: {
  id: string
  name: string
  unit: string
  costPerUnit: unknown
  onHand: unknown
  reorderLevel: unknown
  sku?: string | null
  vendorId?: string | null
  categoryId?: string | null
  vendor?: { name: string } | null
  category?: { name: string } | null
}) {
  const onHand = num(i.onHand as never)
  const reorderLevel = num(i.reorderLevel as never)
  return {
    id: i.id,
    name: i.name,
    unit: i.unit,
    costPerUnit: num(i.costPerUnit as never),
    onHand,
    reorderLevel,
    vendor: i.vendor?.name ?? '',
    category: i.category?.name ?? 'Uncategorized',
    vendorId: i.vendorId ?? null,
    categoryId: i.categoryId ?? null,
    sku: i.sku ?? '',
    status: (onHand <= reorderLevel ? 'low' : 'ok') as 'low' | 'ok',
  }
}

// ------------------------------------------------------------------ Service
@Injectable()
export class IngredientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService,
  ) {}

  async list() {
    const ctx = requireTenant()
    const rows = await this.prisma.client.ingredient.findMany({
      orderBy: { name: 'asc' },
      include: {
        vendor: { select: { name: true } },
        category: { select: { name: true } },
        stock: { where: { locationId: ctx.locationId ?? '' }, select: { onHand: true } },
        pricing: {
          where: { locationId: ctx.locationId ?? '' },
          select: { costPerUnit: true },
        },
      },
    })
    return rows.map((r) =>
      toContract({
        ...r,
        onHand: ctx.locationId ? (r.stock[0]?.onHand ?? 0) : r.onHand,
        costPerUnit: ctx.locationId ? (r.pricing[0]?.costPerUnit ?? r.costPerUnit) : r.costPerUnit,
      }),
    )
  }

  async create(dto: CreateIngredientDto) {
    const ctx = requireTenant()
    await this.assertRefs(dto)
    const created = await this.prisma.client.ingredient.create({
      data: { ...dto, organizationId: ctx.organizationId },
      include: { vendor: { select: { name: true } }, category: { select: { name: true } } },
    })
    if (ctx.locationId && dto.onHand) {
      await this.prisma.client.ingredientLocationStock.create({
        data: { ingredientId: created.id, locationId: ctx.locationId, onHand: dto.onHand },
      })
    }
    return toContract(created)
  }

  async update(id: string, dto: UpdateIngredientDto) {
    await this.assertRefs(dto)
    const updated = await this.prisma.client.ingredient
      .update({
        where: { id },
        data: dto,
        include: { vendor: { select: { name: true } }, category: { select: { name: true } } },
      })
      .catch(() => {
        throw new NotFoundException('Ingredient not found')
      })
    if (dto.costPerUnit !== undefined) {
      const ctx = requireTenant()
      await this.prisma.client.ingredientPriceHistory.create({
        data: {
          organizationId: ctx.organizationId,
          ingredientId: id,
          vendorId: updated.vendorId,
          locationId: ctx.locationId,
          costPerUnit: dto.costPerUnit,
          source: 'manual',
        },
      })
      await this.costing.recalcOrganization(ctx.organizationId)
    }
    return toContract(updated)
  }

  async remove(id: string) {
    try {
      await this.prisma.client.ingredient.delete({ where: { id } })
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'P2003') {
        throw new BadRequestException('Ingredient is used in recipes and cannot be deleted')
      }
      throw new NotFoundException('Ingredient not found')
    }
    return { ok: true }
  }

  private async assertRefs(dto: { categoryId?: string; vendorId?: string }) {
    if (dto.categoryId) {
      const c = await this.prisma.client.category.findUnique({ where: { id: dto.categoryId } })
      if (!c) throw new BadRequestException('Unknown categoryId')
    }
    if (dto.vendorId) {
      const v = await this.prisma.client.vendor.findUnique({ where: { id: dto.vendorId } })
      if (!v) throw new BadRequestException('Unknown vendorId')
    }
  }
}

// --------------------------------------------------------------- Controller
@ApiTags('ingredients')
@ApiCookieAuth()
@Controller('api/ingredients')
export class IngredientsController {
  constructor(private readonly ingredients: IngredientsService) {}

  @Get()
  @ApiOperation({ summary: 'Ingredients with their stock state' })
  list() {
    return this.ingredients.list()
  }

  @Post()
  @Roles('staff')
  @ApiOperation({ summary: 'Create an ingredient (onHand sets the opening balance)' })
  create(@Body() dto: CreateIngredientDto) {
    return this.ingredients.create(dto)
  }

  @Patch(':id')
  @Roles('staff')
  @ApiOperation({
    summary:
      'Update an ingredient; a new cost is recorded in the price history. Stock moves through inventory transactions, not here',
  })
  update(@Param('id') id: string, @Body() dto: UpdateIngredientDto) {
    return this.ingredients.update(id, dto)
  }

  @Delete(':id')
  @Roles('manager')
  @ApiOperation({ summary: 'Delete an ingredient; refused while it is used in recipes' })
  remove(@Param('id') id: string) {
    return this.ingredients.remove(id)
  }
}

@Module({
  imports: [CostingModule],
  providers: [IngredientsService],
  controllers: [IngredientsController],
  exports: [IngredientsService],
})
export class IngredientsModule {}
