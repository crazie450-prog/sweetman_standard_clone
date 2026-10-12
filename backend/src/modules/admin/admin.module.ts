import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module'
import { DocumentsModule } from '../documents/documents.module'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({
  imports: [DocumentsModule, AuthModule],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
