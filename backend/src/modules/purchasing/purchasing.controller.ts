import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { PurchasingService } from './purchasing.service'
import {
  RecommendationsQuery,
  CreateDraftDto,
  DraftsQuery,
  UpdateDraftDto,
} from './dto/purchasing.dto'

@ApiTags('purchasing')
@ApiCookieAuth()
@Controller('api/purchasing')
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  @Get('recommendations')
  @ApiOperation({
    summary:
      'Purchasing recommendations for the active location: usage is the higher of sales-implied and recorded use, plus waste, over the last N days',
  })
  recommendations(@Query() query: RecommendationsQuery) {
    return this.purchasing.recommendations(query)
  }

  @Get('drafts')
  @ApiOperation({
    summary:
      'Draft orders of the active location, newest first, a page at a time; status narrows them',
  })
  list(@Query() query: DraftsQuery) {
    return this.purchasing.list(query)
  }

  @Post('drafts')
  @Roles('staff')
  @ApiOperation({
    summary:
      'Turn chosen recommendations into draft orders, one per vendor; a draft moves no stock and is sent nowhere',
  })
  create(@Body() dto: CreateDraftDto) {
    return this.purchasing.createDrafts(dto)
  }

  @Get('drafts/:id')
  @ApiOperation({ summary: 'One draft order with its lines' })
  detail(@Param('id') id: string) {
    return this.purchasing.detail(id)
  }

  @Patch('drafts/:id')
  @Roles('staff')
  @ApiOperation({
    summary:
      'Adjust a draft: a quantity replaces the line, 0 removes it, a new ingredient adds one',
  })
  update(@Param('id') id: string, @Body() dto: UpdateDraftDto) {
    return this.purchasing.update(id, dto)
  }

  @Post('drafts/:id/approve')
  @Roles('manager')
  @ApiOperation({
    summary:
      'Approve a draft order; it records the decision only; stock still arrives through a confirmed invoice',
  })
  approve(@Param('id') id: string) {
    return this.purchasing.approve(id)
  }

  @Delete('drafts/:id')
  @Roles('manager')
  @ApiOperation({ summary: 'Delete a draft order; an approved one is refused' })
  remove(@Param('id') id: string) {
    return this.purchasing.remove(id)
  }
}
