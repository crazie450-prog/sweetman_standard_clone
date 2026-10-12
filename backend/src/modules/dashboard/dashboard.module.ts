import { Module } from '@nestjs/common'
import { IngredientsModule } from '../ingredients/ingredients.module'
import { DashboardController } from './dashboard.controller'
import { DashboardService } from './dashboard.service'

@Module({
  imports: [IngredientsModule],
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
