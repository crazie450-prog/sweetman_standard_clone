import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { IngredientsService } from '../ingredients/ingredients.service'
import { InventoryService } from './inventory.service'
import { TransactionsQuery, CreateTransactionDto } from './dto/inventory.dto'
import { PeriodQuery } from '../../common/dto/period.dto'
import { PageQuery } from '../../common/dto/pagination.dto'

@ApiTags('inventory')
@ApiCookieAuth()
@Controller('api')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly ingredients: IngredientsService,
  ) {}

  @Get('inventory')
  @ApiOperation({
    summary: 'What each location holds, an archived ingredient with stock left on it included',
  })
  list() {
    return this.ingredients.list('held')
  }

  @Get('inventory/transactions')
  @ApiOperation({
    summary:
      'Inventory transactions, newest first, a page at a time (quantity as a number, unit separate); from, to and type narrow them',
  })
  transactions(@Query() query: TransactionsQuery) {
    return this.inventory.transactions(query)
  }

  @Get('inventory/transactions/summary')
  @ApiOperation({
    summary:
      'Value received, used, wasted and counted over the period, and the net of them, across every movement rather than one page',
  })
  transactionsSummary(@Query() query: PeriodQuery) {
    return this.inventory.transactionsSummary(query)
  }

  @Post('inventory/transactions')
  @Roles('staff')
  @ApiOperation({ summary: 'Inventory movement: updates onHand atomically' })
  createTransaction(@Body() dto: CreateTransactionDto) {
    return this.inventory.createTransaction(dto)
  }

  @Get('reports/usage')
  @ApiOperation({
    summary: 'Weekly consumption: the latest 500 uses, or with from or to every use of that period',
  })
  usage(@Query('from') from?: string, @Query('to') to?: string) {
    return this.inventory.usage(from, to)
  }

  @Get('reports/price-trends')
  @ApiOperation({ summary: 'Price trends: the latest recorded price against the previous one' })
  priceTrends() {
    return this.inventory.priceTrends()
  }

  @Get('ingredients/:id/price-history')
  @ApiOperation({
    summary: 'Ingredient price history with vendor and location, newest first, a page at a time',
  })
  priceHistory(@Param('id') id: string, @Query() query: PageQuery) {
    return this.inventory.priceHistory(id, query)
  }
}
