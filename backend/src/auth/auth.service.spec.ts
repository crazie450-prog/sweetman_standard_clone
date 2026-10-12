import { AuthService } from './auth.service'
import type { PrismaService } from '../prisma/prisma.service'
import type { JwtService } from '@nestjs/jwt'
import type { MailerService } from '../mailer/mailer.service'
import { configWith } from '../../test/config'

describe('AuthService.forgotPassword', () => {
  test('answers without waiting for the mail provider', async () => {
    const prisma = {
      client: {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u1',
            email: 'chef@example.com',
            isActive: true,
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      },
    } as unknown as PrismaService
    const sendPasswordReset = jest.fn(() => new Promise<boolean>(() => {}))
    const mailer = { sendPasswordReset } as unknown as MailerService
    const auth = new AuthService(prisma, {} as JwtService, mailer, configWith())

    const answered = await Promise.race([
      auth.forgotPassword('chef@example.com').then(() => 'answered'),
      new Promise((resolve) => setTimeout(() => resolve('waiting'), 500)),
    ])

    expect(answered).toBe('answered')
    expect(sendPasswordReset).toHaveBeenCalledWith('chef@example.com', expect.any(String))
  })
})
