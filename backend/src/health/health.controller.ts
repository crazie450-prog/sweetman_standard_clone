import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { PrismaService } from '../prisma/prisma.service'
import { Public } from '../common/decorators/public.decorator'

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness and database availability' })
  @ApiOkResponse({
    schema: {
      example: { status: 'ok', database: 'up', timestamp: '2026-07-22T12:00:00.000Z' },
    },
  })
  async check() {
    let database: 'up' | 'down' = 'up'
    try {
      await this.prisma.client.$queryRaw`SELECT 1`
    } catch {
      database = 'down'
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
    }
  }
}
