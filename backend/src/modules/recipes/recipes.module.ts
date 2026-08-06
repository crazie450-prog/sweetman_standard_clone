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
  PartialType,
} from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { requireTenant } from '../../tenancy/tenant-context'
import { Roles } from '../../common/decorators/roles.decorator'
import { money, num, numOrNull } from '../../common/utils/decimal'
import { CostingModule, CostingService } from '../../costing/costing.service'
import { componentContribution, recipeFoodCostPct } from '../../costing/costing.core'

const MENU_USAGE_SELECT = {
  select: { portions: true, menuItem: { select: { price: true } } },
} as const

type MenuUsageRow = { portions: Prisma.Decimal; menuItem: { price: Prisma.Decimal } }

const menuUsageOf = (rows: MenuUsageRow[]) =>
  rows.map((u) => ({ portions: num(u.portions), price: num(u.menuItem.price) }))

// ---------------------------------------------------------------------- DTO
export class RecipeIngredientInput {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  ingredientId!: string

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number

  @ApiProperty({ example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  unit!: string

  @ApiPropertyOptional({ example: 'diced' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  prepNote?: string
}

export class CreateRecipeDto {
  @ApiProperty({ example: 'Beef Wellington' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  portions?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string

  @ApiPropertyOptional({ description: 'Recipe location; empty = every location' })
  @IsOptional()
  @IsString()
  locationId?: string

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  targetFoodCostPct?: number

  @ApiPropertyOptional({ type: [RecipeIngredientInput] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientInput)
  ingredients?: RecipeIngredientInput[]
}
export class UpdateRecipeDto extends PartialType(CreateRecipeDto) {}

export class AddComponentDto {
  @ApiProperty({ description: 'Id of the component recipe' })
  @IsString()
  @IsNotEmpty()
  componentId!: string

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number

  @ApiProperty({
    example: 'kg',
    description:
      'Matching the component yieldUnit means a fraction of the batch; otherwise portions',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  unit!: string

  @ApiPropertyOptional({ example: 'cooled to room temp' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  prepNote?: string
}

// ------------------------------------------------------------------ Service
@Injectable()
export class RecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService,
  ) {}

  async list() {
    const rows = await this.prisma.client.recipe.findMany({
      where: { status: { not: 'archived' } },
      orderBy: { name: 'asc' },
      include: {
        category: { select: { name: true } },
        _count: { select: { components: true, usedIn: true } },
        menuUsage: MENU_USAGE_SELECT,
      },
    })
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category?.name ?? '',
      status: r.status,
      cost: num(r.totalCost),
      targetFoodCostPct: numOrNull(r.targetFoodCostPct),
      foodCostPct: recipeFoodCostPct(
        { totalCost: num(r.totalCost), portions: r.portions },
        menuUsageOf(r.menuUsage),
      ),
      portions: r.portions,
      nested: r._count.components,
      usedIn: r._count.usedIn,
      updatedAt: r.updatedAt.toISOString(),
    }))
  }

  async get(id: string) {
    const r = await this.prisma.client.recipe.findUnique({
      where: { id },
      include: {
        category: { select: { name: true } },
        _count: { select: { components: true } },
        menuUsage: MENU_USAGE_SELECT,
      },
    })
    if (!r) throw new NotFoundException('Recipe not found')
    return {
      id: r.id,
      name: r.name,
      category: r.category?.name ?? '',
      cost: num(r.totalCost),
      targetFoodCostPct: numOrNull(r.targetFoodCostPct),
      foodCostPct: recipeFoodCostPct(
        { totalCost: num(r.totalCost), portions: r.portions },
        menuUsageOf(r.menuUsage),
      ),
      portions: r.portions,
      nested: r._count.components,
      updatedAt: r.updatedAt.toISOString(),
    }
  }

  async detail(id: string) {
    const r = await this.prisma.client.recipe.findUnique({
      where: { id },
      include: {
        category: { select: { name: true } },
        ingredients: {
          orderBy: { order: 'asc' },
          include: { ingredient: { select: { name: true, costPerUnit: true } } },
        },
        components: {
          orderBy: { order: 'asc' },
          include: {
            component: {
              select: {
                id: true,
                name: true,
                totalCost: true,
                portions: true,
                yieldAmount: true,
                yieldUnit: true,
              },
            },
          },
        },
        menuUsage: MENU_USAGE_SELECT,
      },
    })
    if (!r) throw new NotFoundException('Recipe not found')
    return {
      id: r.id,
      name: r.name,
      category: r.category?.name ?? '',
      categoryId: r.categoryId ?? null,
      locationId: r.locationId ?? null,
      description: r.description ?? '',
      portions: r.portions,
      targetFoodCostPct: numOrNull(r.targetFoodCostPct),
      foodCostPct: recipeFoodCostPct(
        { totalCost: num(r.totalCost), portions: r.portions },
        menuUsageOf(r.menuUsage),
      ),
      cost: num(r.totalCost),
      ingredients: r.ingredients.map((ri) => ({
        ingredientId: ri.ingredientId,
        name: ri.ingredient.name,
        qty: num(ri.quantity),
        unit: ri.unit,
        prepNote: ri.prepNote ?? '',
        cost: money(num(ri.quantity) * num(ri.ingredient.costPerUnit)),
      })),
      components: r.components.map((c) => ({
        componentId: c.componentId,
        name: c.component.name,
        qty: num(c.quantity),
        unit: c.unit,
        cost: money(
          componentContribution(
            {
              totalCost: num(c.component.totalCost),
              portions: c.component.portions,
              yieldAmount: numOrNull(c.component.yieldAmount),
              yieldUnit: c.component.yieldUnit,
            },
            { quantity: num(c.quantity), unit: c.unit },
          ),
        ),
        link: c.component.id,
      })),
    }
  }

  async create(dto: CreateRecipeDto) {
    const ctx = requireTenant()
    await this.assertIngredients(dto.ingredients)
    await this.assertLocation(dto.locationId)
    const { ingredients, ...data } = dto
    const created = await this.prisma.client.recipe.create({
      data: {
        ...data,
        organizationId: ctx.organizationId,
        ingredients: ingredients?.length
          ? { create: ingredients.map((i, order) => ({ ...i, order })) }
          : undefined,
      },
    })
    await this.costing.recalcOrganization(ctx.organizationId)
    return this.get(created.id)
  }

  async update(id: string, dto: UpdateRecipeDto) {
    await this.assertIngredients(dto.ingredients)
    await this.assertLocation(dto.locationId)
    const { ingredients, ...data } = dto
    try {
      await this.prisma.client.recipe.update({ where: { id }, data })
    } catch {
      throw new NotFoundException('Recipe not found')
    }
    if (ingredients) {
      await this.prisma.client.$transaction([
        this.prisma.client.recipeIngredient.deleteMany({ where: { recipeId: id } }),
        this.prisma.client.recipeIngredient.createMany({
          data: ingredients.map((i, order) => ({ ...i, recipeId: id, order })),
        }),
      ])
    }
    await this.costing.recalcOrganization(requireTenant().organizationId)
    return this.get(id)
  }

  async remove(id: string) {
    try {
      await this.prisma.client.recipe.delete({ where: { id } })
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'P2003') {
        throw new BadRequestException(
          'Recipe is used as a component or menu item and cannot be deleted',
        )
      }
      throw new NotFoundException('Recipe not found')
    }
    await this.costing.recalcOrganization(requireTenant().organizationId)
    return { ok: true }
  }

  async addComponent(parentId: string, dto: AddComponentDto) {
    const ctx = requireTenant()
    const [parent, component] = await Promise.all([
      this.prisma.client.recipe.findUnique({ where: { id: parentId }, select: { id: true } }),
      this.prisma.client.recipe.findUnique({
        where: { id: dto.componentId },
        select: { id: true },
      }),
    ])
    if (!parent) throw new NotFoundException('Recipe not found')
    if (!component) throw new NotFoundException('Component recipe not found')

    await this.costing.assertEdgeAllowed(ctx.organizationId, parentId, dto.componentId)

    const order = await this.prisma.client.recipeComponent.count({ where: { parentId } })
    try {
      await this.prisma.client.recipeComponent.create({
        data: {
          parentId,
          componentId: dto.componentId,
          quantity: dto.quantity,
          unit: dto.unit,
          prepNote: dto.prepNote,
          order,
        },
      })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new BadRequestException('This component is already part of the recipe')
      }
      throw e
    }
    await this.costing.recalcOrganization(ctx.organizationId)
    return this.detail(parentId)
  }

  async removeComponent(parentId: string, componentId: string) {
    const ctx = requireTenant()
    const { count } = await this.prisma.client.recipeComponent.deleteMany({
      where: { parentId, componentId, parent: { organizationId: ctx.organizationId } },
    })
    if (count === 0) throw new NotFoundException('Component not found')
    await this.costing.recalcOrganization(ctx.organizationId)
    return this.detail(parentId)
  }

  private async assertIngredients(list?: RecipeIngredientInput[]) {
    if (!list?.length) return
    const ids = [...new Set(list.map((i) => i.ingredientId))]
    const found = await this.prisma.client.ingredient.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    })
    if (found.length !== ids.length) throw new BadRequestException('Unknown ingredientId')
  }

  private async assertLocation(locationId?: string) {
    if (!locationId) return
    const found = await this.prisma.client.location.findFirst({
      where: { id: locationId },
      select: { id: true },
    })
    if (!found) throw new BadRequestException('Unknown locationId')
  }
}

// --------------------------------------------------------------- Controller
@ApiTags('recipes')
@ApiCookieAuth()
@Controller('api/recipes')
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get()
  @ApiOperation({ summary: 'Recipes' })
  list() {
    return this.recipes.list()
  }

  @Get(':id')
  @ApiOperation({ summary: 'Recipe summary: cost, portions and nested count' })
  get(@Param('id') id: string) {
    return this.recipes.get(id)
  }

  @Get(':id/detail')
  @ApiOperation({ summary: 'Details: ingredients and nested recipes (link=id)' })
  detail(@Param('id') id: string) {
    return this.recipes.detail(id)
  }

  @Post()
  @Roles('staff')
  @ApiOperation({ summary: 'Create a recipe and recalculate the organization costs' })
  create(@Body() dto: CreateRecipeDto) {
    return this.recipes.create(dto)
  }

  @Patch(':id')
  @Roles('staff')
  @ApiOperation({ summary: 'Update a recipe; passing ingredients replaces the whole list' })
  update(@Param('id') id: string, @Body() dto: UpdateRecipeDto) {
    return this.recipes.update(id, dto)
  }

  @Delete(':id')
  @Roles('manager')
  @ApiOperation({ summary: 'Delete a recipe; refused while it is a component or sits on a menu' })
  remove(@Param('id') id: string) {
    return this.recipes.remove(id)
  }

  @Post(':id/components')
  @Roles('staff')
  @ApiOperation({ summary: 'Nest a recipe inside another recipe (a cycle returns 400)' })
  addComponent(@Param('id') id: string, @Body() dto: AddComponentDto) {
    return this.recipes.addComponent(id, dto)
  }

  @Delete(':id/components/:componentId')
  @Roles('staff')
  @ApiOperation({ summary: 'Remove a nested recipe' })
  removeComponent(@Param('id') id: string, @Param('componentId') componentId: string) {
    return this.recipes.removeComponent(id, componentId)
  }
}

@Module({
  imports: [CostingModule],
  providers: [RecipesService],
  controllers: [RecipesController],
  exports: [RecipesService],
})
export class RecipesModule {}
