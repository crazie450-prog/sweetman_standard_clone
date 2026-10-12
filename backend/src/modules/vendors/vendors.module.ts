import { Module } from '@nestjs/common'
import { VendorsController } from './vendors.controller'
import { VendorsService } from './vendors.service'

@Module({
  providers: [VendorsService],
  controllers: [VendorsController],
})
export class VendorsModule {}
