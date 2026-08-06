import { Controller, Get, Module } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

@ApiTags('documents')
@ApiCookieAuth()
@Controller('api')
export class DocumentsController {
  @Get('documents')
  @ApiOperation({ summary: 'Uploaded documents (the AI ingestion queue lands in Sprint 3)' })
  list() {
    return []
  }

  @Get('imports/order-guides/analysis')
  @ApiOperation({ summary: 'Order guide analysis (Sprint 3)' })
  orderGuideAnalysis() {
    return { sheets: [], detectedVendors: [], existingVendors: [], products: [] }
  }
}

@Module({
  controllers: [DocumentsController],
})
export class DocumentsModule {}
