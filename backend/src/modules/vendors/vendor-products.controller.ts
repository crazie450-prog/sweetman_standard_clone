import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { VendorProductsService } from './vendor-products.service'
import { CreateVendorProductDto, UpdateVendorProductDto } from './dto/vendor-products.dto'

@ApiTags('vendor-products')
@ApiCookieAuth()
@Controller('api/vendor-products')
export class VendorProductsController {
  constructor(private readonly products: VendorProductsService) {}

  @Get()
  @ApiQuery({ name: 'vendorId', required: false })
  @ApiQuery({ name: 'unmappedOnly', required: false, type: Boolean })
  @ApiOperation({ summary: 'What the vendors sell, under their own names and codes' })
  list(@Query('vendorId') vendorId?: string, @Query('unmappedOnly') unmappedOnly?: string) {
    return this.products.list(vendorId, unmappedOnly === 'true')
  }

  @Post()
  @Roles('manager')
  @ApiOperation({ summary: 'Add a product to a vendor catalogue' })
  create(@Body() dto: CreateVendorProductDto) {
    return this.products.create(dto)
  }

  @Patch(':id')
  @Roles('manager')
  @ApiOperation({ summary: 'Rename a product, recode it, or map it to an ingredient' })
  update(@Param('id') id: string, @Body() dto: UpdateVendorProductDto) {
    return this.products.update(id, dto)
  }

  @Delete(':id')
  @Roles('manager')
  @ApiOperation({ summary: 'Remove a product from a vendor catalogue' })
  remove(@Param('id') id: string) {
    return this.products.remove(id)
  }
}
