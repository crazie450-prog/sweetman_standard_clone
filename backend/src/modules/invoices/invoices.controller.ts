import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { InvoicesService } from './invoices.service'
import { CreateInvoiceDto, InvoicesQuery, UpdateInvoiceDto } from './dto/invoices.dto'

@ApiTags('invoices')
@ApiCookieAuth()
@Controller('api/invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ApiOperation({
    summary: 'Vendor invoices, newest first, a page at a time; vendorId narrows to one vendor',
  })
  list(@Query() query: InvoicesQuery) {
    return this.invoices.list(query)
  }

  @Get(':id')
  @ApiOperation({ summary: 'One invoice with its line items' })
  get(@Param('id') id: string) {
    return this.invoices.get(id)
  }

  @Post()
  @Roles('staff')
  @ApiOperation({
    summary:
      'Record an invoice by hand; one read from a document is written when that document is confirmed',
  })
  create(@Body() dto: CreateInvoiceDto) {
    return this.invoices.create(dto)
  }

  @Patch(':id')
  @Roles('staff')
  @ApiOperation({
    summary:
      'Update an invoice; sending items replaces every line. An invoice a confirmed document left is refused',
  })
  update(@Param('id') id: string, @Body() dto: UpdateInvoiceDto) {
    return this.invoices.update(id, dto)
  }

  @Delete(':id')
  @Roles('manager')
  @ApiOperation({
    summary:
      'Delete an invoice and its line items; an invoice a confirmed document left is refused',
  })
  remove(@Param('id') id: string) {
    return this.invoices.remove(id)
  }
}
