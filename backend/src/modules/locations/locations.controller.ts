import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { LocationsService } from './locations.service'
import { CreateLocationDto, UpdateLocationDto } from './dto/locations.dto'

@ApiTags('locations')
@ApiCookieAuth()
@Controller('api')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('properties')
  @ApiOperation({ summary: 'Location switcher feed ({id,name}[])' })
  forSwitcher() {
    return this.locations.listForCurrentUser()
  }

  @Get('locations')
  @Roles('manager')
  @ApiOperation({ summary: 'All organization locations (management view)' })
  listAll() {
    return this.locations.listAll()
  }

  @Post('locations')
  @Roles('admin')
  @ApiOperation({ summary: 'Create a restaurant location' })
  create(@Body() dto: CreateLocationDto) {
    return this.locations.create(dto)
  }

  @Patch('locations/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update a location, or restore it from the archive with isActive' })
  update(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.locations.update(id, dto)
  }

  @Delete('locations/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Archive a location; its data stays and it can be restored' })
  deactivate(@Param('id') id: string) {
    return this.locations.deactivate(id)
  }
}
