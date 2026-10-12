import { Module } from '@nestjs/common'
import { CostingService } from './costing.service'

@Module({
  providers: [CostingService],
  exports: [CostingService],
})
export class CostingModule {}
