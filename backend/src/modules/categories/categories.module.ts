import {
  Body,
  Controller,
  Delete,
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
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { PrismaService } from '../../prisma/prisma.service'
import { requireTenant } from '../../tenancy/tenant-context'
import { Roles } from '../../common/decorators/roles.decorator'
import type { CategoryKind } from '../../generated/prisma/client'

const KINDS = ['ingredient', 'recipe', 'menu'] as const

export class CreateCategoryDto {
  @ApiProperty({ example: 'Meat & Poultry' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string

  @ApiPropertyOptional({ enum: KINDS, default: 'ingredient' })
  @IsOptional()
  @IsIn(KINDS as unknown as string[])
  kind?: CategoryKind
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(kind?: CategoryKind) {
    return this.prisma.client.category.findMany({
      where: kind ? { kind } : undefined,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, kind: true },
    })
  }

  create(dto: CreateCategoryDto) {
    const ctx = requireTenant()
    return this.prisma.client.category.create({
      data: {
        name: dto.name,
        kind: dto.kind ?? 'ingredient',
        organizationId: ctx.organizationId,
      },
      select: { id: true, name: true, kind: true },
    })
  }

  async remove(id: string) {
    try {
      await this.prisma.client.category.delete({ where: { id } })
    } catch {
      throw new NotFoundException('Category not found')
    }
    return { ok: true }
  }
}

@ApiTags('categories')
@ApiCookieAuth()
@Controller('api/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Categories (?kind=ingredient|recipe|menu)' })
  list(@Query('kind') kind?: CategoryKind) {
    return this.categories.list(kind && KINDS.includes(kind) ? kind : undefined)
  }

  @Post()
  @Roles('manager')
  @ApiOperation({ summary: 'Create a category' })
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto)
  }

  @Delete(':id')
  @Roles('manager')
  @ApiOperation({
    summary: 'Delete a category (ingredients and recipes keep working, they become uncategorized)',
  })
  remove(@Param('id') id: string) {
    return this.categories.remove(id)
  }
}

@Module({
  providers: [CategoriesService],
  controllers: [CategoriesController],
})
export class CategoriesModule {}
