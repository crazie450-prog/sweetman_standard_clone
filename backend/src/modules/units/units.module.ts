import { Module } from '@nestjs/common'
import { CostingModule } from '../../costing/costing.module'
import { UnitsController, UnitCatalogueController } from './units.controller'
import { UnitsService } from './units.service'

@Module({
  imports: [CostingModule],
  providers: [UnitsService],
  exports: [UnitsService],
  controllers: [UnitsController, UnitCatalogueController],
})
export class UnitsModule {}
