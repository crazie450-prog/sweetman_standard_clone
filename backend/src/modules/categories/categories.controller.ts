import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { CategoriesService } from './categories.service'
import { CategoriesQuery, CreateCategoryDto, RenameCategoryDto } from './dto/categories.dto'

@ApiTags('categories')
@ApiCookieAuth()
@Controller('api/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({
    summary: 'Categories (?kind=ingredient|recipe|menu) with how many records each one files',
  })
  list(@Query() query: CategoriesQuery) {
    return this.categories.list(query.kind)
  }

  @Post()
  @Roles('staff')
  @ApiOperation({
    summary: "Create a category; a chef may add one where it is chosen, deleting stays a manager's",
  })
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto)
  }

  @Patch(':id')
  @Roles('manager')
  @ApiOperation({ summary: 'Rename a category; everything it files shows the new name' })
  rename(@Param('id') id: string, @Body() dto: RenameCategoryDto) {
    return this.categories.rename(id, dto)
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
