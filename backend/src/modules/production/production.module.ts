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
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator'
import { PrismaService } from '../../prisma/prisma.service'
import { requireLocation, requireTenant } from '../../tenancy/tenant-context'
import { Roles } from '../../common/decorators/roles.decorator'
import { money, num } from '../../common/utils/decimal'

export class CreateProductionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  recipeId!: string

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number

  @ApiProperty({ example: 'l' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  unit!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  madeBy?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  date?: string
}

@Injectable()
export class ProductionService {
  constructor(private readonly prisma: PrismaService) {}

  async batches() {
    const rows = await this.prisma.client.production.findMany({
      orderBy: { date: 'desc' },
      take: 200,
      include: { recipe: { select: { name: true } } },
    })
    return rows.map((p) => ({
      id: p.id,
      recipe: p.recipe.name,
      qty: `${num(p.quantity)} ${p.unit}`,
      madeBy: p.madeBy ?? '',
      date: p.date.toISOString(),
      cost: num(p.cost),
    }))
  }

  async create(dto: CreateProductionDto) {
    const ctx = requireTenant()
    const locationId = requireLocation()
    const recipe = await this.prisma.client.recipe.findUnique({ where: { id: dto.recipeId } })
    if (!recipe) throw new BadRequestException('Unknown recipeId')
    const cost = money(num(recipe.totalCost))
    return this.prisma.client.production.create({
      data: {
        organizationId: ctx.organizationId,
        locationId,
        recipeId: dto.recipeId,
        quantity: dto.quantity,
        unit: dto.unit,
        cost,
        madeBy: dto.madeBy,
        date: dto.date ? new Date(dto.date) : new Date(),
      },
    })
  }
}

@ApiTags('production')
@ApiCookieAuth()
@Controller('api')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get('production')
  @ApiOperation({ summary: 'Production batches' })
  batches() {
    return this.production.batches()
  }

  @Post('production')
  @Roles('staff')
  @ApiOperation({ summary: 'Record a production batch (does not deduct stock yet)' })
  create(@Body() dto: CreateProductionDto) {
    return this.production.create(dto)
  }

  @Get('prep-list')
  @ApiOperation({ summary: 'Prep suggestions (the predictive module lands in Sprint 4)' })
  prepSuggestions() {
    return []
  }
}

@Module({
  providers: [ProductionService],
  controllers: [ProductionController],
})
export class ProductionModule {}
