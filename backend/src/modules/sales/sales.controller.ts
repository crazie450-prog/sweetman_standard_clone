import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { SalesService } from './sales.service'
import { CreateSaleDto, SaleLinesQuery } from './dto/sales.dto'

@ApiTags('sales')
@ApiCookieAuth()
@Controller('api/sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('daily')
  @ApiOperation({
    summary: 'Sales by day: every day of the stated period, or the last 90 days without one',
  })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD' })
  daily(@Query('from') from?: string, @Query('to') to?: string) {
    return this.sales.daily(from, to)
  }

  @Get()
  @ApiOperation({
    summary:
      'Sold items a page at a time, newest first or by line total: lines of the stated period, or of the last 90 days without one; minTotal and maxTotal narrow them',
  })
  individual(@Query() query: SaleLinesQuery) {
    return this.sales.individual(query)
  }

  @Get('menu-items')
  @ApiOperation({ summary: 'Menu item names (filter source)' })
  menuItemNames() {
    return this.sales.menuItemNames()
  }

  @Post()
  @Roles('staff')
  @ApiOperation({ summary: 'Record a sale: price and cost are stored as a point-in-time snapshot' })
  create(@Body() dto: CreateSaleDto) {
    return this.sales.create(dto)
  }
}
