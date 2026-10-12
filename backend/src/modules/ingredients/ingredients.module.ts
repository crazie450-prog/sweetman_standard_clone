import { Module } from '@nestjs/common'
import { CostingModule } from '../../costing/costing.module'
import { IngredientsController } from './ingredients.controller'
import { IngredientsService } from './ingredients.service'

@Module({
  imports: [CostingModule],
  providers: [IngredientsService],
  controllers: [IngredientsController],
  exports: [IngredientsService],
})
export class IngredientsModule {}
