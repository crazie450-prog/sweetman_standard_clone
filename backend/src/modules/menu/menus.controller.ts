import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { MenusService } from './menus.service'
import { CreateMenuDto, UpdateMenuDto } from './dto/menus.dto'

@ApiTags('menus')
@ApiCookieAuth()
@Controller('api/menus')
export class MenusController {
  constructor(private readonly menus: MenusService) {}

  @Get()
  @ApiOperation({ summary: 'Menus with the locations that serve them and their cost analytics' })
  list() {
    return this.menus.list()
  }

  @Get(':id')
  @ApiOperation({ summary: 'One menu with every item it includes and the analytics over them' })
  get(@Param('id') id: string) {
    return this.menus.get(id)
  }

  @Get(':id/available-items')
  @ApiOperation({
    summary:
      'Menu items this menu can include: those sold at every location or at a location that serves the menu',
  })
  available(@Param('id') id: string) {
    return this.menus.available(id)
  }

  @Post()
  @Roles('manager')
  @ApiOperation({ summary: 'Create a menu' })
  create(@Body() dto: CreateMenuDto) {
    return this.menus.create(dto)
  }

  @Patch(':id')
  @Roles('manager')
  @ApiOperation({
    summary: 'Rename a menu, change what it includes, or assign it to other locations',
  })
  update(@Param('id') id: string, @Body() dto: UpdateMenuDto) {
    return this.menus.update(id, dto)
  }

  @Delete(':id')
  @Roles('manager')
  @ApiOperation({ summary: 'Delete a menu; the items it grouped stay in the catalogue' })
  remove(@Param('id') id: string) {
    return this.menus.remove(id)
  }
}
