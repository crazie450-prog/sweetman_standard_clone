import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common'
import { IsInt, Max, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { GlobalExceptionFilter, ValidationFailed } from './http-exception.filter'

function respond(exception: unknown) {
  const sent: { status?: number; body?: unknown } = {}
  const res = {
    status: (code: number) => ({
      json: (body: unknown) => Object.assign(sent, { status: code, body }),
    }),
  }
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ url: '/x', method: 'POST' }),
    }),
  } as unknown as ArgumentsHost
  const logger = { error: jest.fn() }
  const filter = new GlobalExceptionFilter(logger as never, undefined)
  filter.catch(exception, host)
  return { ...sent, logged: logger.error.mock.calls.length }
}

const prismaValidation = (message: string) =>
  Object.assign(new Error(message), { name: 'PrismaClientValidationError' })

describe('GlobalExceptionFilter answers what the database refuses', () => {
  test('null in a column that cannot hold it names the field', () => {
    const r = respond(
      prismaValidation('Invalid `x.create()` invocation\n\nArgument `portions` must not be null.'),
    )
    expect(r.status).toBe(400)
    expect(r.body).toEqual({
      error: { code: 'VALUE_REQUIRED', message: 'portions must not be null' },
    })
    expect(r.logged).toBe(0)
  })

  test('a null where a value of a type is expected names the field too', () => {
    const r = respond(
      prismaValidation(
        'Argument `isActive`: Invalid value provided. Expected Boolean, provided Null.',
      ),
    )
    expect(r.status).toBe(400)
    expect(r.body).toEqual({
      error: { code: 'VALUE_REQUIRED', message: 'isActive must not be null' },
    })
  })

  test('a missing argument is a bad request', () => {
    const r = respond(prismaValidation('Argument `organization` is missing.'))
    expect(r.status).toBe(400)
  })

  test('a control character the encoding refuses is a bad request', () => {
    const r = respond(
      new Error(
        'Database error. Code: `22021`. Message: `invalid byte sequence for encoding "UTF8": 0x00`',
      ),
    )
    expect(r.status).toBe(400)
    expect(r.body).toEqual({
      error: {
        code: 'TEXT_UNSUPPORTED_CHARACTER',
        message: 'Text contains a character that cannot be stored',
      },
    })
  })

  test.each(['55P03', '40P01', '40001'])(
    'a lock or serialization refusal %s asks to try again',
    (code) => {
      const r = respond(
        Object.assign(new Error('Raw query failed'), {
          code: 'P2010',
          meta: { driverAdapterError: { cause: { code, kind: 'postgres' } } },
        }),
      )
      expect(r.status).toBe(409)
      expect(r.body).toMatchObject({
        error: { code: 'RECORDS_BUSY', message: expect.stringMatching(/try again/) as string },
      })
      expect(r.logged).toBe(0)
    },
  )

  test.each(['P2034', 'P2028'])(
    'a transaction Prisma gives up on (%s) asks to try again',
    (code) => {
      const r = respond(Object.assign(new Error('Transaction failed'), { code }))
      expect(r.status).toBe(409)
      expect(r.body).toMatchObject({ error: { code: 'RECORDS_BUSY' } })
    },
  )

  test('a value the column cannot hold names no column and says so', () => {
    const r = respond(new Error('Database error: numeric field overflow'))
    expect(r.status).toBe(400)
    expect(r.body).toMatchObject({ error: { code: 'VALUE_TOO_LARGE' } })
  })

  test('a duplicate names the column that clashed, never the tenant columns', () => {
    const r = respond(
      Object.assign(new Error('Unique constraint'), {
        code: 'P2002',
        meta: { target: ['organizationId', 'name'] },
      }),
    )
    expect(r.status).toBe(409)
    expect(r.body).toEqual({
      error: { code: 'DUPLICATE_RECORD', message: 'Another record already uses this name' },
    })
  })

  test('a record still referenced and a record gone have their own codes', () => {
    expect(respond(Object.assign(new Error('fk'), { code: 'P2003' })).body).toMatchObject({
      error: { code: 'RECORD_IN_USE' },
    })
    const gone = respond(Object.assign(new Error('gone'), { code: 'P2025' }))
    expect(gone.status).toBe(404)
    expect(gone.body).toMatchObject({ error: { code: 'RECORD_NOT_FOUND' } })
  })

  test('anything else is an internal error that is logged and tells the caller nothing of it', () => {
    const r = respond(new Error('boom at /srv/app/secret.ts:12 password=hunter2'))
    expect(r.status).toBe(500)
    expect(r.logged).toBe(1)
    expect(r.body).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Something went wrong on our side; try again in a moment',
      },
    })
    expect(JSON.stringify(r.body)).not.toMatch(/boom|secret|hunter2|stack|at \//)
  })
})

class Line {
  @IsInt()
  @Max(10)
  quantity!: number
}

class Order {
  @IsInt()
  limit!: number

  @ValidateNested({ each: true })
  @Type(() => Line)
  lines!: Line[]
}

describe('GlobalExceptionFilter answers every refusal in one envelope', () => {
  test('a service refusal keeps its own code and sentence', () => {
    const r = respond(
      new ConflictException({
        code: 'DRAFT_ALREADY_APPROVED',
        message: 'This order has already been approved',
      }),
    )
    expect(r.status).toBe(409)
    expect(r.body).toEqual({
      error: { code: 'DRAFT_ALREADY_APPROVED', message: 'This order has already been approved' },
    })
  })

  test('an exception without a code is given the one its status names', () => {
    expect(respond(new NotFoundException()).body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not Found' },
    })
    expect(respond(new ForbiddenException('Nope')).body).toEqual({
      error: { code: 'FORBIDDEN', message: 'Nope' },
    })
    expect(respond(new HttpException('Slow down', 429)).body).toEqual({
      error: { code: 'TOO_MANY_REQUESTS', message: 'Slow down' },
    })
  })

  test('a validation failure lists each field it refused, nested ones by their path', async () => {
    const pipe = new ValidationPipe({
      exceptionFactory: (errors) =>
        new ValidationFailed(
          errors.flatMap((e) =>
            [e, ...(e.children ?? []).flatMap((c) => c.children ?? [])].flatMap((x) =>
              Object.values(x.constraints ?? {}).map((message) => ({
                field: x.property,
                message,
              })),
            ),
          ),
        ),
    })
    const failure = await pipe
      .transform({ limit: 'many', lines: [{ quantity: 99 }] }, { type: 'body', metatype: Order })
      .catch((e: unknown) => e)
    const r = respond(failure)
    expect(r.status).toBe(400)
    const body = r.body as { error: { code: string; message: string; details: unknown[] } }
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.message).toBe('Validation failed')
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        { field: 'limit', message: 'limit must be an integer number' },
        { field: 'quantity', message: 'quantity must not be greater than 10' },
      ]),
    )
  })

  test('a bare list of messages still reads as a validation failure', () => {
    const r = respond(new BadRequestException(['name should not be empty']))
    expect(r.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'name', message: 'name should not be empty' }],
      },
    })
  })
})
