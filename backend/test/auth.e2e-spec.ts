import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import * as argon2 from 'argon2'
import { ConfigService } from '@nestjs/config'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { PrismaService } from '../src/prisma/prisma.service'
import { configWith } from './config'

jest.setTimeout(30000)

describe('Auth (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let http: ReturnType<INestApplication['getHttpServer']>

  const EMAIL = 'e2e-owner@test.nexus'
  const PASSWORD = 'Sup3r_secret!'
  const ORG = 'E2E Test Kitchen'

  const cookiesOf = (res: request.Response): string[] => {
    const raw = res.headers['set-cookie']
    return Array.isArray(raw) ? raw : raw ? [raw] : []
  }
  const cookieHeader = (cookies: string[]) => cookies.map((c) => c.split(';')[0]).join('; ')

  const appWith = async (overrides: Record<string, string>) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(configWith(overrides))
      .compile()
    const other = moduleRef.createNestApplication()
    configureApp(other)
    await other.init()
    return other
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    configureApp(app)
    await app.init()
    http = app.getHttpServer()
    prisma = app.get(PrismaService)

    await prisma.client.organization.deleteMany({ where: { name: ORG } })
  })

  afterAll(async () => {
    await prisma.client.organization.deleteMany({ where: { name: ORG } })
    await app.close()
  })

  let authCookies: string[] = []

  test('register: creates the org, owner and location, and sets the cookies', async () => {
    const res = await request(http)
      .post('/api/auth/register')
      .send({ organizationName: ORG, fullName: 'E2E Owner', email: EMAIL, password: PASSWORD })
      .expect(201)

    expect(res.body.email).toBe(EMAIL)
    expect(res.body.role).toBe('owner')
    expect(res.body.organizationName).toBe(ORG)
    expect(res.body.locations).toHaveLength(1)
    expect(res.body.locations[0].name).toBe('Main')

    authCookies = cookiesOf(res)
    expect(authCookies.some((c) => c.startsWith('access_token='))).toBe(true)
    expect(authCookies.some((c) => c.startsWith('refresh_token='))).toBe(true)
    expect(authCookies.every((c) => /httponly/i.test(c))).toBe(true)
  })

  test('register with an already used email returns 409', async () => {
    await request(http)
      .post('/api/auth/register')
      .send({ organizationName: 'Dup', fullName: 'X', email: EMAIL, password: PASSWORD })
      .expect(409)
  })

  describe('two sign-ups at the same moment', () => {
    const TWIN = 'E2E Twin Kitchen'
    const NAMELESS = '& & &'
    const twins = [1, 2].map((n) => `e2e-twin-${n}@test.nexus`)
    const clear = () =>
      prisma.client.organization.deleteMany({ where: { name: { in: [TWIN, NAMELESS] } } })

    beforeAll(clear)
    afterAll(clear)

    const register = (organizationName: string, email: string) =>
      request(http)
        .post('/api/auth/register')
        .send({ organizationName, fullName: 'E2E Twin', email, password: PASSWORD })

    test.each([
      ['the same organization name', TWIN],
      ['a name that leaves no letters for the address', NAMELESS],
    ])('under %s both succeed', async (_, name) => {
      await clear()
      const answers = await Promise.all(twins.map((email) => register(name, email)))
      expect(answers.map((r) => [r.status, r.body?.error?.code])).toEqual([
        [201, undefined],
        [201, undefined],
      ])
      const orgs = await prisma.client.organization.findMany({ where: { name } })
      expect(new Set(orgs.map((o) => o.slug)).size).toBe(2)
    })

    test('with one address, one succeeds and the other is told the address is taken', async () => {
      await clear()
      const answers = await Promise.all([register(TWIN, twins[0]), register(NAMELESS, twins[0])])
      expect(answers.map((r) => r.status).sort()).toEqual([201, 409])
      expect(answers.find((r) => r.status === 409)!.body.error.code).toBe(
        'EMAIL_ALREADY_REGISTERED',
      )
      expect(
        await prisma.client.organization.count({ where: { name: { in: [TWIN, NAMELESS] } } }),
      ).toBe(1)
    })
  })

  test('me: returns the user behind the cookie', async () => {
    const res = await request(http)
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(authCookies))
      .expect(200)
    expect(res.body.email).toBe(EMAIL)
  })

  test('me without a cookie returns 401 from the global guard', async () => {
    await request(http).get('/api/auth/me').expect(401)
  })

  test('refresh: rotates the pair, and the previous token presented after the grace poisons the session', async () => {
    const first = await request(http)
      .get('/api/auth/refresh')
      .set('Cookie', cookieHeader(authCookies))
      .expect(200)
    const rotated = cookiesOf(first)
    const user = await prisma.client.user.findUniqueOrThrow({ where: { email: EMAIL } })
    await prisma.client.userSession.updateMany({
      where: { userId: user.id },
      data: { lastUsedAt: new Date(Date.now() - 31_000) },
    })

    await request(http)
      .get('/api/auth/refresh')
      .set('Cookie', cookieHeader(authCookies))
      .expect(401)

    await request(http).get('/api/auth/refresh').set('Cookie', cookieHeader(rotated)).expect(401)

    const relogin = await request(http)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200)
    authCookies = cookiesOf(relogin)
  })

  test('logout: clears the cookies and /me then returns 401', async () => {
    await request(http)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader(authCookies))
      .expect(200)
    await request(http)
      .get('/api/auth/refresh')
      .set('Cookie', cookieHeader(authCookies))
      .expect(401)

    const relogin = await request(http)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200)
    authCookies = cookiesOf(relogin)
  })

  test('two devices hold two sessions: signing in on one does not end the other', async () => {
    const phone = cookiesOf(
      await request(http)
        .post('/api/auth/login')
        .set('User-Agent', 'Nexus/phone')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200),
    )
    const laptop = cookiesOf(
      await request(http)
        .post('/api/auth/login')
        .set('User-Agent', 'Nexus/laptop')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200),
    )

    const user = await prisma.client.user.findUniqueOrThrow({ where: { email: EMAIL } })
    const sessions = await prisma.client.userSession.findMany({ where: { userId: user.id } })
    expect(sessions.length).toBeGreaterThanOrEqual(2)
    expect(sessions.map((s) => s.userAgent)).toEqual(
      expect.arrayContaining(['Nexus/phone', 'Nexus/laptop']),
    )

    await request(http).get('/api/auth/me').set('Cookie', cookieHeader(phone)).expect(200)
    const phoneRefreshed = cookiesOf(
      await request(http).get('/api/auth/refresh').set('Cookie', cookieHeader(phone)).expect(200),
    )

    await request(http)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader(phoneRefreshed))
      .expect(200)
    await request(http)
      .get('/api/auth/refresh')
      .set('Cookie', cookieHeader(phoneRefreshed))
      .expect(401)

    await request(http).get('/api/auth/refresh').set('Cookie', cookieHeader(laptop)).expect(200)
  })

  test('changing the password keeps this session and ends every other one', async () => {
    const NEW_PASSWORD = 'Nexus_dev2'
    const first = cookiesOf(
      await request(http)
        .post('/api/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200),
    )
    const second = cookiesOf(
      await request(http)
        .post('/api/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200),
    )

    await request(http)
      .post('/api/auth/change-password')
      .set('Cookie', cookieHeader(first))
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200)

    await request(http).get('/api/auth/refresh').set('Cookie', cookieHeader(second)).expect(401)
    const user = await prisma.client.user.findUniqueOrThrow({ where: { email: EMAIL } })
    expect(await prisma.client.userSession.count({ where: { userId: user.id } })).toBe(1)
    await request(http).get('/api/auth/refresh').set('Cookie', cookieHeader(first)).expect(200)
    await prisma.client.userSession.deleteMany({ where: { userId: user.id } })

    const back = cookiesOf(
      await request(http)
        .post('/api/auth/login')
        .send({ email: EMAIL, password: NEW_PASSWORD })
        .expect(200),
    )
    await request(http)
      .post('/api/auth/change-password')
      .set('Cookie', cookieHeader(back))
      .send({ currentPassword: NEW_PASSWORD, newPassword: PASSWORD })
      .expect(200)
  })

  test('a new password that cannot end the other sessions is not set either', async () => {
    const session = cookiesOf(
      await request(http)
        .post('/api/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200),
    )
    await request(http)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200)
    const user = await prisma.client.user.findUniqueOrThrow({ where: { email: EMAIL } })
    await prisma.client.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION e2e_refuse_logout() RETURNS trigger AS $$
      BEGIN
        IF OLD."userId" = '${user.id}' THEN RAISE EXCEPTION 'e2e refuses the logout'; END IF;
        RETURN OLD;
      END $$ LANGUAGE plpgsql`)
    await prisma.client.$executeRawUnsafe(
      `CREATE TRIGGER e2e_refuse_logout BEFORE DELETE ON "UserSession" FOR EACH ROW EXECUTE FUNCTION e2e_refuse_logout()`,
    )
    try {
      const res = await request(http)
        .post('/api/auth/change-password')
        .set('Cookie', cookieHeader(session))
        .send({ currentPassword: PASSWORD, newPassword: 'Nexus_dev3' })
      expect(res.status).toBeGreaterThanOrEqual(400)
    } finally {
      await prisma.client.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS e2e_refuse_logout ON "UserSession"',
      )
      await prisma.client.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_refuse_logout()')
    }
    const still = await request(http)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
    if (still.status !== 200) {
      const back = cookiesOf(
        await request(http)
          .post('/api/auth/login')
          .send({ email: EMAIL, password: 'Nexus_dev3' })
          .expect(200),
      )
      await request(http)
        .post('/api/auth/change-password')
        .set('Cookie', cookieHeader(back))
        .send({ currentPassword: 'Nexus_dev3', newPassword: PASSWORD })
        .expect(200)
    }
    await prisma.client.userSession.deleteMany({ where: { userId: user.id } })
    expect(still.status).toBe(200)
  })

  test('login: a wrong password returns 401 with a generic message', async () => {
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: 'wrong-password' })
      .expect(401)
    expect(res.body.error.message).toBe('Invalid email or password')
    const res2 = await request(http)
      .post('/api/auth/login')
      .send({ email: 'ghost@test.nexus', password: 'whatever1' })
      .expect(401)
    expect(res2.body.error.message).toBe(res.body.error.message)
  })

  test('lockout after five failed attempts, and an expired lockout starts the count over', async () => {
    for (let i = 0; i < 4; i++) {
      await request(http)
        .post('/api/auth/login')
        .send({ email: EMAIL, password: 'wrong-password' })
        .expect(401)
    }
    const locked = await request(http)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(423)
    expect(locked.body.error.message).toMatch(/locked/i)

    await prisma.client.user.update({
      where: { email: EMAIL },
      data: { lockoutUntil: new Date(Date.now() - 60 * 1000) },
    })
    await request(http)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: 'wrong-password' })
      .expect(401)
    const afterExpiry = await prisma.client.user.findUniqueOrThrow({ where: { email: EMAIL } })
    expect(afterExpiry.failedLoginAttempts).toBe(1)
    expect(afterExpiry.lockoutUntil).toBeNull()

    const relogin = await request(http)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200)
    authCookies = cookiesOf(relogin)
  })

  test('forgot then reset: the new password works and the old refresh is revoked', async () => {
    await request(http).post('/api/auth/forgot-password').send({ email: EMAIL }).expect(200)
    const user = await prisma.client.user.findUniqueOrThrow({ where: { email: EMAIL } })
    expect(user.passwordResetToken).toBeTruthy()

    const rawToken = 'e2e-reset-token-known'
    const { createHash } = await import('node:crypto')
    await prisma.client.user.update({
      where: { email: EMAIL },
      data: { passwordResetToken: createHash('sha256').update(rawToken).digest('hex') },
    })

    const NEW_PASSWORD = 'N3w_secret!!'
    await request(http)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, password: NEW_PASSWORD })
      .expect(200)

    await request(http)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(401)
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: NEW_PASSWORD })
      .expect(200)
    authCookies = cookiesOf(res)
  })

  describe('a reset link is delivered by mail or not at all', () => {
    const hashOf = async (raw: string) => {
      const { createHash } = await import('node:crypto')
      return createHash('sha256').update(raw).digest('hex')
    }

    test('forgot-password answers the same way whoever asks, and hands back no link', async () => {
      const known = await request(http)
        .post('/api/auth/forgot-password')
        .send({ email: EMAIL })
        .expect(200)
      const unknown = await request(http)
        .post('/api/auth/forgot-password')
        .send({ email: 'nobody@test.nexus' })
        .expect(200)

      expect(known.body).toEqual(unknown.body)
      const printed = JSON.stringify(known.body)
      expect(printed).not.toMatch(/token/i)
      expect(printed).not.toContain('reset-password?')
    })

    test('a reset token is spent by the first use', async () => {
      const raw = 'e2e-single-use-token'
      await prisma.client.user.update({
        where: { email: EMAIL },
        data: {
          passwordResetToken: await hashOf(raw),
          passwordResetExpires: new Date(Date.now() + 3600_000),
        },
      })

      const password = 'N3w_secret!!'
      await request(http)
        .post('/api/auth/reset-password')
        .send({ token: raw, password })
        .expect(200)
      await request(http)
        .post('/api/auth/reset-password')
        .send({ token: raw, password: 'An0ther_try!!' })
        .expect(401)

      const res = await request(http)
        .post('/api/auth/login')
        .send({ email: EMAIL, password })
        .expect(200)
      authCookies = cookiesOf(res)
    })
  })

  test('health responds without authentication', async () => {
    const res = await request(http).get('/health').expect(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.database).toBe('up')
  })

  describe('a password is guessed at no door more than at sign-in', () => {
    const GUESS_ORG = 'E2E Guess Kitchen'
    const GUESS_EMAIL = 'e2e-guess@test.nexus'

    afterAll(async () => {
      await prisma.client.organization.deleteMany({ where: { name: GUESS_ORG } })
    })

    test('wrong current passwords lock the account as wrong sign-ins do', async () => {
      await prisma.client.organization.deleteMany({ where: { name: GUESS_ORG } })
      const registered = await request(http)
        .post('/api/auth/register')
        .send({
          organizationName: GUESS_ORG,
          fullName: 'E2E Guess',
          email: GUESS_EMAIL,
          password: PASSWORD,
        })
        .expect(201)
      const cookie = cookieHeader(cookiesOf(registered))

      for (let i = 0; i < 3; i++) {
        await request(http)
          .post('/api/auth/change-password')
          .set('Cookie', cookie)
          .send({ currentPassword: `Wrong_guess${i}!`, newPassword: 'Taken_over_9!' })
          .expect(401)
      }
      for (let i = 0; i < 2; i++) {
        await request(http)
          .patch('/api/auth/me')
          .set('Cookie', cookie)
          .send({ email: `e2e-thief${i}@test.nexus`, currentPassword: `Wrong_again${i}!` })
          .expect(401)
      }
      await request(http)
        .post('/api/auth/change-password')
        .set('Cookie', cookie)
        .send({ currentPassword: PASSWORD, newPassword: 'Taken_over_9!' })
        .expect(423)
      await request(http)
        .post('/api/auth/login')
        .send({ email: GUESS_EMAIL, password: PASSWORD })
        .expect(423)
      const user = await prisma.client.user.findUniqueOrThrow({ where: { email: GUESS_EMAIL } })
      expect(await argon2.verify(user.hashedPassword, PASSWORD)).toBe(true)
    })
  })

  describe('own profile', () => {
    test('PATCH /me changes the name and cannot change the role', async () => {
      const res = await request(http)
        .patch('/api/auth/me')
        .set('Cookie', cookieHeader(authCookies))
        .send({ fullName: 'E2E Owner Renamed' })
        .expect(200)
      expect(res.body.fullName).toBe('E2E Owner Renamed')
      expect(res.body.role).toBe('owner')

      await request(http)
        .patch('/api/auth/me')
        .set('Cookie', cookieHeader(authCookies))
        .send({ role: 'admin' })
        .expect(400)
      const after = await prisma.client.user.findUniqueOrThrow({ where: { email: EMAIL } })
      expect(after.role).toBe('owner')
    })

    test('changing the password requires the current one and keeps the session it was changed from', async () => {
      const CURRENT = 'N3w_secret!!'
      const NEXT = 'Even_newer1!'

      await request(http)
        .post('/api/auth/change-password')
        .set('Cookie', cookieHeader(authCookies))
        .send({ currentPassword: 'not-the-password', newPassword: NEXT })
        .expect(401)

      await request(http)
        .post('/api/auth/change-password')
        .set('Cookie', cookieHeader(authCookies))
        .send({ currentPassword: CURRENT, newPassword: NEXT })
        .expect(200)

      await request(http)
        .get('/api/auth/refresh')
        .set('Cookie', cookieHeader(authCookies))
        .expect(200)

      await request(http)
        .post('/api/auth/login')
        .send({ email: EMAIL, password: CURRENT })
        .expect(401)
      const relogin = await request(http)
        .post('/api/auth/login')
        .send({ email: EMAIL, password: NEXT })
        .expect(200)
      authCookies = cookiesOf(relogin)
    })

    test('a sign-in email is changed only with the current password, and a name of spaces is refused', async () => {
      const NOW = 'Even_newer1!'
      const moved = 'e2e-owner-moved@test.nexus'
      await request(http)
        .patch('/api/auth/me')
        .set('Cookie', cookieHeader(authCookies))
        .send({ fullName: '   ' })
        .expect(400)
      await request(http)
        .patch('/api/auth/me')
        .set('Cookie', cookieHeader(authCookies))
        .send({ email: moved })
        .expect(400)
      await request(http)
        .patch('/api/auth/me')
        .set('Cookie', cookieHeader(authCookies))
        .send({ email: moved, currentPassword: 'not-the-password' })
        .expect(401)
      await request(http)
        .post('/api/auth/change-password')
        .set('Cookie', cookieHeader(authCookies))
        .send({ currentPassword: 'x'.repeat(129), newPassword: 'Whatever_new1' })
        .expect(400)
      await request(http)
        .patch('/api/auth/me')
        .set('Cookie', cookieHeader(authCookies))
        .send({ email: moved, currentPassword: NOW })
        .expect(200)
      await request(http)
        .patch('/api/auth/me')
        .set('Cookie', cookieHeader(authCookies))
        .send({ email: EMAIL, currentPassword: NOW })
        .expect(200)
    })
  })

  describe('invitations', () => {
    const INVITEE = 'e2e-chef@test.nexus'
    let inviteToken = ''

    test('create: an owner invites a staff member', async () => {
      await request(http)
        .post('/api/invitations')
        .set('Cookie', cookieHeader(authCookies))
        .send({ email: INVITEE, role: 'staff' })
        .expect(201)
      const inv = await prisma.client.invitation.findFirst({
        where: { email: INVITEE, status: 'pending' },
      })
      inviteToken = inv!.token
    })

    test('without a mail provider the API says so and hands back the link', async () => {
      const res = await request(http)
        .post('/api/invitations')
        .set('Cookie', cookieHeader(authCookies))
        .send({ email: 'e2e-link@test.nexus', role: 'staff' })
        .expect(201)

      expect(res.body.emailDelivered).toBe(false)
      expect(res.body.acceptUrl).toMatch(/\/signup\?invite=[a-f0-9]{64}$/)

      const token = String(res.body.acceptUrl).split('invite=')[1]
      await request(http).get(`/api/invitations/${token}`).expect(200)

      await request(http)
        .delete(`/api/invitations/${res.body.id}`)
        .set('Cookie', cookieHeader(authCookies))
        .expect(200)
    })

    test("the team list is a manager's, as the screen already is", async () => {
      const chef = await request(http)
        .post('/api/auth/login')
        .send({ email: 'ken@goldenfork.com', password: 'Nexus_dev1' })
        .expect(200)
      await request(http)
        .get('/api/users')
        .set('Cookie', cookieHeader(cookiesOf(chef)))
        .expect(403)
    })

    test('an invitation past its expiry is listed as expired, not as invited', async () => {
      const EXPIRED = 'e2e-expired@test.nexus'
      const owner =
        authCookies.length > 0
          ? cookieHeader(authCookies)
          : cookieHeader(
              cookiesOf(
                await request(http)
                  .post('/api/auth/login')
                  .send({ email: 'owner@goldenfork.com', password: 'Nexus_dev1' })
                  .expect(200),
              ),
            )
      const created = await request(http)
        .post('/api/invitations')
        .set('Cookie', owner)
        .send({ email: EXPIRED, role: 'staff' })
        .expect(201)
      try {
        await prisma.client.invitation.update({
          where: { id: created.body.id },
          data: { expiresAt: new Date(Date.now() - 60_000) },
        })
        const res = await request(http).get('/api/users').set('Cookie', owner).expect(200)
        const row = (res.body as { email: string; status: string }[]).find(
          (m) => m.email === EXPIRED,
        )
        expect(row?.status).toBe('expired')
      } finally {
        await prisma.client.invitation.delete({ where: { id: created.body.id } })
      }
    })

    test('preview: public, returns the organization, email and role', async () => {
      const res = await request(http).get(`/api/invitations/${inviteToken}`).expect(200)
      expect(res.body.email).toBe(INVITEE)
      expect(res.body.role).toBe('staff')
      expect(res.body.organizationName).toBe(ORG)
      expect(res.body).not.toHaveProperty('token')
    })

    test('preview of an unknown token returns 404', async () => {
      await request(http).get('/api/invitations/definitely-not-a-token').expect(404)
    })

    test('resend: issues a new token and retires the previous one', async () => {
      const before = await prisma.client.invitation.findFirstOrThrow({
        where: { email: INVITEE, status: 'pending' },
      })
      const res = await request(http)
        .post(`/api/invitations/${before.id}/resend`)
        .set('Cookie', cookieHeader(authCookies))
        .expect(200)
      expect(res.body.email).toBe(INVITEE)

      const after = await prisma.client.invitation.findUniqueOrThrow({ where: { id: before.id } })
      expect(after.token).not.toBe(before.token)
      expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime())

      await request(http).get(`/api/invitations/${before.token}`).expect(404)
      await request(http).get(`/api/invitations/${after.token}`).expect(200)
      inviteToken = after.token
    })

    test('accept: creates the user and signs them in', async () => {
      const res = await request(http)
        .post(`/api/invitations/${inviteToken}/accept`)
        .send({ fullName: 'E2E Chef', password: 'Chef_pass1!' })
        .expect(200)
      expect(res.body.email).toBe(INVITEE)
      expect(res.body.role).toBe('staff')
      expect(res.body.organizationName).toBe(ORG)
    })

    test('accepting the same token twice returns 404', async () => {
      await request(http)
        .post(`/api/invitations/${inviteToken}/accept`)
        .send({ fullName: 'X', password: 'Whatever1!' })
        .expect(404)
    })

    test('staff cannot invite (403) while an owner can', async () => {
      const staffLogin = await request(http)
        .post('/api/auth/login')
        .send({ email: INVITEE, password: 'Chef_pass1!' })
        .expect(200)
      await request(http)
        .post('/api/invitations')
        .set('Cookie', cookieHeader(cookiesOf(staffLogin)))
        .send({ email: 'more@test.nexus', role: 'viewer' })
        .expect(403)
    })
  })
  describe('a password reset a person can finish', () => {
    const MEMBER = 'e2e-chef@test.nexus'
    const NEW_PASSWORD = 'Reset_by_admin1!'
    let memberId = ''
    let memberCookies: string[] = []

    beforeAll(async () => {
      const member = await prisma.client.user.findUniqueOrThrow({ where: { email: MEMBER } })
      memberId = member.id
      const signedIn = await request(http)
        .post('/api/auth/login')
        .send({ email: MEMBER, password: 'Chef_pass1!' })
        .expect(200)
      memberCookies = cookiesOf(signedIn)
    })

    test('an administrator issues the reset and, with no mail provider, is handed the link', async () => {
      const res = await request(http)
        .post(`/api/users/${memberId}/password-reset`)
        .set('Cookie', cookieHeader(authCookies))
        .expect(200)

      expect(res.body.emailDelivered).toBe(false)
      expect(res.body.resetUrl).toContain('/reset-password?token=')

      const token = new URL(res.body.resetUrl as string).searchParams.get('token')
      await request(http)
        .post('/api/auth/reset-password')
        .send({ token, password: NEW_PASSWORD })
        .expect(200)

      await request(http)
        .post('/api/auth/login')
        .send({ email: MEMBER, password: NEW_PASSWORD })
        .expect(200)
      await request(http)
        .post('/api/auth/login')
        .send({ email: MEMBER, password: 'Chef_pass1!' })
        .expect(401)
    })

    test('the reset ends the sessions the member already had', async () => {
      await request(http)
        .get('/api/auth/refresh')
        .set('Cookie', cookieHeader(memberCookies))
        .expect(401)
    })

    test('a member cannot issue a reset for anyone', async () => {
      const signedIn = await request(http)
        .post('/api/auth/login')
        .send({ email: MEMBER, password: NEW_PASSWORD })
        .expect(200)
      await request(http)
        .post(`/api/users/${memberId}/password-reset`)
        .set('Cookie', cookieHeader(cookiesOf(signedIn)))
        .expect(403)
    })

    test('an administrator of another organization is answered 404', async () => {
      const outsider = await request(http)
        .post('/api/auth/login')
        .send({ email: 'owner@goldenfork.com', password: 'Nexus_dev1' })
        .expect(200)
      await request(http)
        .post(`/api/users/${memberId}/password-reset`)
        .set('Cookie', cookieHeader(cookiesOf(outsider)))
        .expect(404)
    })

    test('an administrator may not issue a reset for the owner, nor for another administrator', async () => {
      const ADMIN = 'e2e-admin@test.nexus'
      await request(http)
        .post('/api/invitations')
        .set('Cookie', cookieHeader(authCookies))
        .send({ email: ADMIN, role: 'admin' })
        .expect(201)
      const invitation = await prisma.client.invitation.findFirstOrThrow({
        where: { email: ADMIN, status: 'pending' },
      })
      const joined = await request(http)
        .post(`/api/invitations/${invitation.token}/accept`)
        .send({ fullName: 'E2E Admin', password: 'Admin_pass1!' })
        .expect(200)
      const adminCookies = cookieHeader(cookiesOf(joined))

      const owner = await prisma.client.user.findFirstOrThrow({ where: { email: EMAIL } })
      const self = await prisma.client.user.findFirstOrThrow({ where: { email: ADMIN } })

      await request(http)
        .post(`/api/users/${owner.id}/password-reset`)
        .set('Cookie', adminCookies)
        .expect(403)
      await request(http)
        .post(`/api/users/${self.id}/password-reset`)
        .set('Cookie', adminCookies)
        .expect(403)

      await request(http)
        .post(`/api/users/${memberId}/password-reset`)
        .set('Cookie', adminCookies)
        .expect(200)
    })

    test('a deactivated member is answered 404 rather than handed a way back in', async () => {
      await prisma.client.user.update({ where: { id: memberId }, data: { isActive: false } })
      await request(http)
        .post(`/api/users/${memberId}/password-reset`)
        .set('Cookie', cookieHeader(authCookies))
        .expect(404)
      await prisma.client.user.update({ where: { id: memberId }, data: { isActive: true } })
    })

    test('a reset link stops working once the password or the email changes, or the member is deactivated', async () => {
      const issue = async () => {
        const res = await request(http)
          .post(`/api/users/${memberId}/password-reset`)
          .set('Cookie', cookieHeader(authCookies))
          .expect(200)
        return new URL(res.body.resetUrl as string).searchParams.get('token')
      }
      const signIn = async (password: string) =>
        cookieHeader(
          cookiesOf(
            await request(http)
              .post('/api/auth/login')
              .send({ email: MEMBER, password })
              .expect(200),
          ),
        )
      const spent = async (token: string | null) => {
        const res = await request(http)
          .post('/api/auth/reset-password')
          .send({ token, password: 'Taken_over1!' })
        expect(res.status).toBe(401)
      }

      const afterPassword = await issue()
      await request(http)
        .post('/api/auth/change-password')
        .set('Cookie', await signIn(NEW_PASSWORD))
        .send({ currentPassword: NEW_PASSWORD, newPassword: 'Changed_self1!' })
        .expect(200)
      await spent(afterPassword)

      const afterEmail = await issue()
      const MOVED = 'e2e-chef-moved@test.nexus'
      await request(http)
        .patch('/api/auth/me')
        .set('Cookie', await signIn('Changed_self1!'))
        .send({ email: MOVED, currentPassword: 'Changed_self1!' })
        .expect(200)
      await prisma.client.user.update({ where: { id: memberId }, data: { email: MEMBER } })
      await spent(afterEmail)

      const afterDeactivation = await issue()
      await prisma.client.user.update({ where: { id: memberId }, data: { isActive: false } })
      try {
        await spent(afterDeactivation)
      } finally {
        await prisma.client.user.update({
          where: { id: memberId },
          data: { isActive: true, hashedPassword: await argon2.hash(NEW_PASSWORD) },
        })
      }
    })
  })

  describe('a deactivated member is brought back, not invited again', () => {
    const RETURNING = 'e2e-returning@test.nexus'
    let memberId = ''

    beforeAll(async () => {
      await request(http)
        .post('/api/invitations')
        .set('Cookie', cookieHeader(authCookies))
        .send({ email: RETURNING, role: 'viewer' })
        .expect(201)
      const inv = await prisma.client.invitation.findFirstOrThrow({
        where: { email: RETURNING, status: 'pending' },
      })
      await request(http)
        .post(`/api/invitations/${inv.token}/accept`)
        .send({ fullName: 'E2E Returning', password: 'Return_pass1!' })
        .expect(200)
      memberId = (await prisma.client.user.findUniqueOrThrow({ where: { email: RETURNING } })).id
    })

    test('the team list keeps a deactivated member, marked inactive', async () => {
      await request(http)
        .delete(`/api/users/${memberId}`)
        .set('Cookie', cookieHeader(authCookies))
        .expect(200)
      const res = await request(http)
        .get('/api/users')
        .set('Cookie', cookieHeader(authCookies))
        .expect(200)
      const row = (res.body as { id: string; status: string }[]).find((m) => m.id === memberId)
      expect(row?.status).toBe('inactive')
    })

    test('inviting them again says to reactivate them instead', async () => {
      const res = await request(http)
        .post('/api/invitations')
        .set('Cookie', cookieHeader(authCookies))
        .send({ email: RETURNING, role: 'viewer' })
        .expect(409)
      expect(res.body.error.message).toMatch(/deactivated; reactivate them from the Team list/)
    })

    test('reactivating gives the account back with its role, and it signs in', async () => {
      const res = await request(http)
        .post(`/api/users/${memberId}/reactivate`)
        .set('Cookie', cookieHeader(authCookies))
        .expect(200)
      expect(res.body.status).toBe('active')
      expect(res.body.role).toBe('viewer')
      await request(http)
        .post('/api/auth/login')
        .send({ email: RETURNING, password: 'Return_pass1!' })
        .expect(200)
    })

    test('reactivating an active member changes nothing and says so', async () => {
      await prisma.client.user.update({
        where: { id: memberId },
        data: { failedLoginAttempts: 3 },
      })
      const res = await request(http)
        .post(`/api/users/${memberId}/reactivate`)
        .set('Cookie', cookieHeader(authCookies))
        .expect(400)
      expect(res.body.error.message).toBe('This member is already active')
      const after = await prisma.client.user.findUniqueOrThrow({ where: { id: memberId } })
      expect(after.failedLoginAttempts).toBe(3)
      await prisma.client.user.update({ where: { id: memberId }, data: { failedLoginAttempts: 0 } })
    })

    test('a member is told they are one, and another organization is not named', async () => {
      const member = await request(http)
        .post('/api/invitations')
        .set('Cookie', cookieHeader(authCookies))
        .send({ email: RETURNING, role: 'viewer' })
        .expect(409)
      expect(member.body.error.message).toBe('This person is already a member of the team')

      const elsewhere = await request(http)
        .post('/api/invitations')
        .set('Cookie', cookieHeader(authCookies))
        .send({ email: 'owner@bellacucina.com', role: 'viewer' })
        .expect(409)
      expect(elsewhere.body.error.message).toBe('This email is already registered')
      expect(
        await prisma.client.invitation.count({ where: { email: 'owner@bellacucina.com' } }),
      ).toBe(0)
    })

    test('only an administrator of the same organization reactivates', async () => {
      const viewer = await request(http)
        .post('/api/auth/login')
        .send({ email: RETURNING, password: 'Return_pass1!' })
        .expect(200)
      await request(http)
        .post(`/api/users/${memberId}/reactivate`)
        .set('Cookie', cookieHeader(cookiesOf(viewer)))
        .expect(403)

      const stranger = await prisma.client.user.findUniqueOrThrow({
        where: { email: 'owner@bellacucina.com' },
      })
      await request(http)
        .post(`/api/users/${stranger.id}/reactivate`)
        .set('Cookie', cookieHeader(authCookies))
        .expect(404)
    })
  })

  test('a public sign-in route answers 429 after too many attempts from one address, and only to it', async () => {
    const limited = await appWith({ AUTH_RATE_LIMIT: 'on' })
    try {
      const ask = (address: string) =>
        request(limited.getHttpServer())
          .post('/api/auth/forgot-password')
          .set('X-Forwarded-For', address)
          .send({ email: 'nobody-at-all@test.nexus' })
      for (let i = 0; i < 5; i++) await ask('203.0.113.9').expect(200)
      const refused = await ask('203.0.113.9').expect(429)
      expect(refused.body.error.message).toMatch(/wait a minute/)
      await ask('203.0.113.10').expect(200)
    } finally {
      await limited.close()
    }
  })

  test('names of spaces are refused wherever a person states one', async () => {
    await request(http)
      .post('/api/auth/register')
      .send({
        organizationName: '   ',
        fullName: 'Probe Person',
        email: 'spaces-org@test.nexus',
        password: 'Nexus_dev1',
      })
      .expect(400)
    await request(http)
      .post('/api/auth/register')
      .send({
        organizationName: 'Probe Org',
        fullName: '   ',
        email: 'spaces-name@test.nexus',
        password: 'Nexus_dev1',
      })
      .expect(400)
    expect(
      await prisma.client.user.count({
        where: { email: { in: ['spaces-org@test.nexus', 'spaces-name@test.nexus'] } },
      }),
    ).toBe(0)
  })

  test('the access cookie lives as long as the access token', async () => {
    const longer = await appWith({ JWT_ACCESS_TTL: '30m' })
    try {
      const res = await request(longer.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'owner@goldenfork.com', password: 'Nexus_dev1' })
        .expect(200)
      const raw = res.headers['set-cookie'] as unknown as string[]
      const access = raw.find((c) => c.startsWith('access_token='))
      expect(access).toMatch(/Max-Age=1800/)
    } finally {
      await longer.close()
    }
  })

  test('an unknown address is checked against a password as long as a known one', async () => {
    const took = async (email: string) => {
      const started = process.hrtime.bigint()
      await request(http)
        .post('/api/auth/login')
        .send({ email, password: 'wrong-password-1' })
        .expect(401)
      return Number(process.hrtime.bigint() - started) / 1e6
    }
    const known: number[] = []
    const unknown: number[] = []
    try {
      for (let i = 0; i < 3; i++) {
        known.push(await took(EMAIL))
        unknown.push(await took(`nobody-${i}@test.nexus`))
      }
    } finally {
      await prisma.client.user.update({
        where: { email: EMAIL },
        data: { failedLoginAttempts: 0, lockoutUntil: null },
      })
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[1]
    expect(median(unknown)).toBeGreaterThan(median(known) * 0.5)
  })

  test('every answer carries the security headers and does not name the framework', async () => {
    const res = await request(http).get('/api/auth/me').expect(401)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})
