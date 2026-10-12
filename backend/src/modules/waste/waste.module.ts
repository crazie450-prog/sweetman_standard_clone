import { Module } from '@nestjs/common'
import { WasteController } from './waste.controller'
import { WasteService } from './waste.service'

@Module({
  providers: [WasteService],
  controllers: [WasteController],
})
export class WasteModule {}
