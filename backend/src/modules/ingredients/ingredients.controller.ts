import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { IngredientsService } from './ingredients.service'
import { CreateIngredientDto, UpdateIngredientDto } from './dto/ingredients.dto'

@ApiTags('ingredients')
@ApiCookieAuth()
@Controller('api/ingredients')
export class IngredientsController {
  constructor(private readonly ingredients: IngredientsService) {}

  @Get()
  @ApiOperation({ summary: 'Active ingredients with their stock state' })
  @ApiQuery({
    name: 'includeArchived',
    required: false,
    description: 'true also returns archived ingredients',
  })
  list(@Query('includeArchived') includeArchived?: string) {
    return this.ingredients.list(includeArchived === 'true')
  }

  @Get(':id/locations')
  @ApiOperation({
    summary: 'What each location pays, buys from and holds for one shared ingredient',
  })
  atLocations(@Param('id') id: string) {
    return this.ingredients.atLocations(id)
  }

  @Post()
  @Roles('staff')
  @ApiOperation({
    summary: 'Create an ingredient; onHand is an opening count at the location in the header',
  })
  create(@Body() dto: CreateIngredientDto) {
    return this.ingredients.create(dto)
  }

  @Patch(':id')
  @Roles('staff')
  @ApiOperation({
    summary:
      "Update an ingredient; a new cost is recorded in the price history. Stock moves through inventory transactions, not here; isActive is a manager's",
  })
  update(@Param('id') id: string, @Body() dto: UpdateIngredientDto) {
    return this.ingredients.update(id, dto)
  }

  @Delete(':id')
  @Roles('manager')
  @ApiOperation({
    summary: 'Delete an ingredient; refused once anything refers to it, so archive it instead',
  })
  remove(@Param('id') id: string) {
    return this.ingredients.remove(id)
  }
}
