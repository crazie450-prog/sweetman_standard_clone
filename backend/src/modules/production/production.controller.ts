import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { ProductionService } from './production.service'
import { CreateProductionDto } from './dto/production.dto'
import { PagedPeriodQuery, PeriodQuery } from '../../common/dto/period.dto'

@ApiTags('production')
@ApiCookieAuth()
@Controller('api')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get('production')
  @ApiOperation({
    summary: 'Production batches, newest first, a page at a time; from and to narrow them',
  })
  batches(@Query() query: PagedPeriodQuery) {
    return this.production.batches(query)
  }

  @Get('production/summary')
  @ApiOperation({
    summary:
      'Batches, their total and average cost and how many recipes they made, across the period rather than one page',
  })
  summary(@Query() query: PeriodQuery) {
    return this.production.summary(query)
  }

  @Post('production')
  @Roles('staff')
  @ApiOperation({ summary: 'Record a production batch and its cost; it does not move stock' })
  create(@Body() dto: CreateProductionDto) {
    return this.production.create(dto)
  }
}
