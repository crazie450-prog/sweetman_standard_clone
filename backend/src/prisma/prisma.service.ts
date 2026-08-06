import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'
import { tenantExtension } from '../tenancy/tenant.extension'

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  return new PrismaClient({ adapter }).$extends(tenantExtension)
}

export type TenantScopedClient = ReturnType<typeof createClient>

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: TenantScopedClient = createClient()

  async onModuleInit() {
    await this.client.$connect()
  }

  async onModuleDestroy() {
    await this.client.$disconnect()
  }
}
