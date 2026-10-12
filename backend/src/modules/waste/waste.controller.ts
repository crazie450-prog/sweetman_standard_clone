import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { WasteService } from './waste.service'
import { CreateWasteEntryDto } from './dto/waste.dto'
import { PagedPeriodQuery } from '../../common/dto/period.dto'

@ApiTags('waste')
@ApiCookieAuth()
@Controller('api/waste')
export class WasteController {
  constructor(private readonly waste: WasteService) {}

  @Get()
  @ApiOperation({
    summary: 'Waste entries, newest first, a page at a time; from and to narrow them',
  })
  entries(@Query() query: PagedPeriodQuery) {
    return this.waste.entries(query)
  }

  @Get('ingredients')
  @ApiOperation({ summary: 'Ingredients available to the waste form' })
  ingredients() {
    return this.waste.ingredients()
  }

  @Get('reasons')
  @ApiOperation({ summary: 'Waste reason reference list' })
  reasons() {
    return this.waste.reasons()
  }

  @Post()
  @Roles('staff')
  @ApiOperation({
    summary: 'Waste: writes the entry, the WASTE transaction and the onHand update in one step',
  })
  create(@Body() dto: CreateWasteEntryDto) {
    return this.waste.create(dto)
  }
}
