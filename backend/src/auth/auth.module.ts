import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { ThrottlerModule } from '@nestjs/throttler'
import { rateLimitOptions } from './rate-limit'
import { AuthCookies } from './cookies'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'

@Module({
  imports: [
    JwtModule.register({ global: true }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => rateLimitOptions(config),
    }),
  ],
  providers: [AuthService, AuthCookies],
  controllers: [AuthController],
  exports: [AuthService, AuthCookies],
})
export class AuthModule {}
