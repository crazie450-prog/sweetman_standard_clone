import type { Response } from 'express'
import { HealthController } from './health.controller'
import type { PrismaService } from '../prisma/prisma.service'

function fakeRes(): Response & { code: number } {
  const res = {
    code: 0,
    status(c: number) {
      res.code = c
      return res
    },
  }
  return res as unknown as Response & { code: number }
}

describe('HealthController', () => {
  it('reports up and 200 when the database answers', async () => {
    const prisma = {
      client: { $queryRaw: () => Promise.resolve([{ 1: 1 }]) },
    } as unknown as PrismaService
    const res = fakeRes()
    const body = await new HealthController(prisma).check(res)
    expect(res.code).toBe(200)
    expect(body).toMatchObject({ status: 'ok', database: 'up' })
  })

  it('reports degraded and 503 when the database is down', async () => {
    const prisma = {
      client: { $queryRaw: () => Promise.reject(new Error('no db')) },
    } as unknown as PrismaService
    const res = fakeRes()
    const body = await new HealthController(prisma).check(res)
    expect(res.code).toBe(503)
    expect(body).toMatchObject({ status: 'degraded', database: 'down' })
  })
})
