import { Module } from '@nestjs/common'
import { PurchasingController } from './purchasing.controller'
import { PurchasingService } from './purchasing.service'

@Module({
  providers: [PurchasingService],
  controllers: [PurchasingController],
})
export class PurchasingModule {}
