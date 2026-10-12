import { Module } from '@nestjs/common'
import { VendorProductsController } from './vendor-products.controller'
import { VendorProductsService } from './vendor-products.service'

@Module({
  providers: [VendorProductsService],
  controllers: [VendorProductsController],
  exports: [VendorProductsService],
})
export class VendorProductsModule {}
