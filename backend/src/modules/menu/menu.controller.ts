import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { MenuService } from './menu.service'
import { CreateMenuItemDto, UpdateMenuItemDto } from './dto/menu.dto'

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
