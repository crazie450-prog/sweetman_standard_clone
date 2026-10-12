import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { VendorsService } from './vendors.service'
import { CreateVendorDto, UpdateVendorDto } from './dto/vendors.dto'

@ApiTags('vendors')
@ApiCookieAuth()
@Controller('api/vendors')
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Get()
  @ApiOperation({ summary: 'Organization vendors' })
  list() {
    return this.vendors.list()
  }

  @Get('spend')
  @ApiOperation({ summary: 'Confirmed invoice spend for the last six months' })
  spend() {
    return this.vendors.spend()
  }

  @Post()
  @Roles('manager')
  @ApiOperation({ summary: 'Create a vendor' })
  create(@Body() dto: CreateVendorDto) {
    return this.vendors.create(dto)
  }

  @Patch(':id')
  @Roles('manager')
  @ApiOperation({ summary: 'Update a vendor' })
  update(@Param('id') id: string, @Body() dto: UpdateVendorDto) {
    return this.vendors.update(id, dto)
  }

  @Delete(':id')
  @Roles('manager')
  @ApiOperation({
    summary:
      'Delete a vendor no invoice names; its ingredients stay and lose the link, and its product catalogue goes with it',
  })
  remove(@Param('id') id: string) {
    return this.vendors.remove(id)
  }
}
