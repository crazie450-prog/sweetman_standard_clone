import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { unitCatalogue } from '../../costing/units'
import { UnitsService } from './units.service'
import { CreateUnitConversionDto, UpdateUnitConversionDto } from './dto/units.dto'

@ApiTags('units')
@ApiCookieAuth()
@Controller('api/unit-conversions')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  @ApiOperation({ summary: 'Unit conversions, organization-wide first' })
  list() {
    return this.units.list()
  }

  @Post()
  @Roles('manager')
  @ApiOperation({ summary: 'Record a conversion and recost the recipes that use it' })
  create(@Body() dto: CreateUnitConversionDto) {
    return this.units.create(dto)
  }

  @Patch(':id')
  @Roles('manager')
  @ApiOperation({ summary: 'Change a conversion and recost' })
  update(@Param('id') id: string, @Body() dto: UpdateUnitConversionDto) {
    return this.units.update(id, dto)
  }

  @Delete(':id')
  @Roles('manager')
  @ApiOperation({ summary: 'Remove a conversion and recost' })
  remove(@Param('id') id: string) {
    return this.units.remove(id)
  }
}

@ApiTags('units')
@ApiCookieAuth()
@Controller('api/units')
export class UnitCatalogueController {
  @Get()
  @ApiOperation({
    summary: 'The units the platform understands, with the dimension each one belongs to',
  })
  list() {
    return unitCatalogue()
  }
}
