import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { PrismaService } from '../src/prisma/prisma.service'

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

  test('refresh: rotates the pair and poisons the previous refresh token', async () => {
    const first = await request(http)
      .get('/api/auth/refresh')
      .set('Cookie', cookieHeader(authCookies))
      .expect(200)
    const rotated = cookiesOf(first)

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

  test('changing the password ends every session, on every device', async () => {
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

    await request(http).get('/api/auth/refresh').set('Cookie', cookieHeader(first)).expect(401)
    await request(http).get('/api/auth/refresh').set('Cookie', cookieHeader(second)).expect(401)

    const user = await prisma.client.user.findUniqueOrThrow({ where: { email: EMAIL } })
    const left = await prisma.client.userSession.count({ where: { userId: user.id } })
    expect(left).toBe(0)

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

  test('login: a wrong password returns 401 with a generic message', async () => {
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: 'wrong-password' })
      .expect(401)
    expect(res.body.message).toBe('Invalid email or password')
    const res2 = await request(http)
      .post('/api/auth/login')
      .send({ email: 'ghost@test.nexus', password: 'whatever1' })
      .expect(401)
    expect(res2.body.message).toBe(res.body.message)
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
    expect(locked.body.message).toMatch(/locked/i)

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

  test('health responds without authentication', async () => {
    const res = await request(http).get('/health').expect(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.database).toBe('up')
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

    test('changing the password requires the current one and revokes other sessions', async () => {
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
        .expect(401)

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
})
