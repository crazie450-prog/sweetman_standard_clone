import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { RecipesService } from './recipes.service'
import {
  CreateRecipeDto,
  UpdateRecipeDto,
  AddComponentDto,
  UpdateComponentDto,
} from './dto/recipes.dto'

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

  @Patch(':id/components/:componentId')
  @Roles('staff')
  @ApiOperation({
    summary: 'Change how much of a nested recipe goes into this one; costs are recalculated',
  })
  updateComponent(
    @Param('id') id: string,
    @Param('componentId') componentId: string,
    @Body() dto: UpdateComponentDto,
  ) {
    return this.recipes.updateComponent(id, componentId, dto)
  }

  @Delete(':id/components/:componentId')
  @Roles('staff')
  @ApiOperation({ summary: 'Remove a nested recipe' })
  removeComponent(@Param('id') id: string, @Param('componentId') componentId: string) {
    return this.recipes.removeComponent(id, componentId)
  }
}
