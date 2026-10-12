import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'
import { tenantExtension } from '../tenancy/tenant.extension'
import type { AppConfig } from '../config/env.validation'

function createClient(connectionString: string) {
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter }).$extends(tenantExtension)
}

export type TenantScopedClient = ReturnType<typeof createClient>

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: TenantScopedClient

  constructor(@Inject(ConfigService) config: AppConfig) {
    this.client = createClient(config.getOrThrow('DATABASE_URL', { infer: true }))
  }

  async onModuleInit() {
    await this.client.$connect()
  }

  async onModuleDestroy() {
    await this.client.$disconnect()
  }
}
