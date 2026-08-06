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
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { PrismaService } from '../../prisma/prisma.service'
import { requireTenant } from '../../tenancy/tenant-context'
import { Roles } from '../../common/decorators/roles.decorator'
import { money, num } from '../../common/utils/decimal'

export class MenuItemRecipeInput {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  recipeId!: string

  @ApiPropertyOptional({ default: 1, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  portions?: number
}

export class CreateMenuItemDto {
  @ApiProperty({ example: 'Beef Wellington (for two)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string

  @ApiPropertyOptional({ description: 'Item location; empty = every location' })
  @IsOptional()
  @IsString()
  locationId?: string

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean

  @ApiPropertyOptional({ type: [MenuItemRecipeInput] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuItemRecipeInput)
  recipes?: MenuItemRecipeInput[]
}
export class UpdateMenuItemDto extends PartialType(CreateMenuItemDto) {}

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.client.menuItem.findMany({
      orderBy: { name: 'asc' },
      include: {
        category: { select: { name: true } },
        location: { select: { name: true } },
        recipes: {
          include: {
            recipe: { select: { id: true, name: true, totalCost: true, portions: true } },
          },
        },
      },
    })
    return rows.map((m) => {
      const cost = money(
        m.recipes.reduce(
          (sum, r) =>
            sum + (num(r.recipe.totalCost) / Math.max(1, r.recipe.portions)) * num(r.portions),
          0,
        ),
      )
      return {
        id: m.id,
        name: m.name,
        category: m.category?.name ?? '',
        categoryId: m.categoryId ?? null,
        locationId: m.locationId ?? null,
        location: m.location?.name ?? '',
        recipes: m.recipes.map((r) => ({
          id: r.recipe.id,
          name: r.recipe.name,
          portions: num(r.portions),
        })),
        price: num(m.price),
        cost,
        active: m.isActive,
      }
    })
  }

  async create(dto: CreateMenuItemDto) {
    const ctx = requireTenant()
    await this.assertRecipes(dto.recipes)
    await this.assertLocation(dto.locationId)
    const { recipes, ...data } = dto
    await this.prisma.client.menuItem.create({
      data: {
        ...data,
        organizationId: ctx.organizationId,
        recipes: recipes?.length
          ? { create: recipes.map((r) => ({ recipeId: r.recipeId, portions: r.portions ?? 1 })) }
          : undefined,
      },
    })
    return { ok: true }
  }

  async update(id: string, dto: UpdateMenuItemDto) {
    await this.assertRecipes(dto.recipes)
    await this.assertLocation(dto.locationId)
    const { recipes, ...data } = dto
    try {
      await this.prisma.client.menuItem.update({ where: { id }, data })
    } catch {
      throw new NotFoundException('Menu item not found')
    }
    if (recipes) {
      await this.prisma.client.$transaction([
        this.prisma.client.menuItemRecipe.deleteMany({ where: { menuItemId: id } }),
        this.prisma.client.menuItemRecipe.createMany({
          data: recipes.map((r) => ({
            menuItemId: id,
            recipeId: r.recipeId,
            portions: r.portions ?? 1,
          })),
        }),
      ])
    }
    return { ok: true }
  }

  async remove(id: string) {
    try {
      await this.prisma.client.menuItem.delete({ where: { id } })
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'P2003') {
        throw new BadRequestException('Menu item has sales history; deactivate it instead')
      }
      throw new NotFoundException('Menu item not found')
    }
    return { ok: true }
  }

  private async assertRecipes(list?: MenuItemRecipeInput[]) {
    if (!list?.length) return
    const ids = [...new Set(list.map((r) => r.recipeId))]
    const found = await this.prisma.client.recipe.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    })
    if (found.length !== ids.length) throw new BadRequestException('Unknown recipeId')
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

@ApiTags('menu')
@ApiCookieAuth()
@Controller('api/menu-items')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get()
  @ApiOperation({ summary: 'Menu items (recipes={id,name}[])' })
  list() {
    return this.menu.list()
  }

  @Post()
  @Roles('staff')
  @ApiOperation({ summary: 'Create a menu item from one or more recipes' })
  create(@Body() dto: CreateMenuItemDto) {
    return this.menu.create(dto)
  }

  @Patch(':id')
  @Roles('staff')
  @ApiOperation({ summary: 'Update a menu item; passing recipes replaces the whole composition' })
  update(@Param('id') id: string, @Body() dto: UpdateMenuItemDto) {
    return this.menu.update(id, dto)
  }

  @Delete(':id')
  @Roles('manager')
  @ApiOperation({ summary: 'Delete a menu item; refused once it has sales history' })
  remove(@Param('id') id: string) {
    return this.menu.remove(id)
  }
}

@Module({
  providers: [MenuService],
  controllers: [MenuController],
})
export class MenuModule {}
