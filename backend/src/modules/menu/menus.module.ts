import { Module } from '@nestjs/common'
import { MenusController } from './menus.controller'
import { MenusService } from './menus.service'

@Module({
  providers: [MenusService],
  controllers: [MenusController],
  exports: [MenusService],
})
export class MenusModule {}
