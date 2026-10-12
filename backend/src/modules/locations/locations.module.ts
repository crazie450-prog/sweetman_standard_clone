import { Module } from '@nestjs/common'
import { BillingModule } from '../../billing/billing.module'
import { LocationsController } from './locations.controller'
import { LocationsService } from './locations.service'

@Module({
  imports: [BillingModule],
  providers: [LocationsService],
  controllers: [LocationsController],
})
export class LocationsModule {}
