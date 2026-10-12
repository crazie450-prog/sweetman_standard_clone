import { Module } from '@nestjs/common'
import { ProductionController } from './production.controller'
import { ProductionService } from './production.service'

@Module({
  providers: [ProductionService],
  controllers: [ProductionController],
})
export class ProductionModule {}
