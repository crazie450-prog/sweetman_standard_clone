import { Controller, Get, Res } from '@nestjs/common'
import type { Response } from 'express'
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
  async check(@Res({ passthrough: true }) res: Response) {
    let database: 'up' | 'down' = 'up'
    try {
      await this.prisma.client.$queryRaw`SELECT 1`
    } catch {
      database = 'down'
    }
    res.status(database === 'up' ? 200 : 503)
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
    }
  }
}
