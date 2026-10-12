import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module'
import { TeamController } from './team.controller'
import { TeamService } from './team.service'

@Module({
  imports: [AuthModule],
  providers: [TeamService],
  controllers: [TeamController],
})
export class TeamModule {}
