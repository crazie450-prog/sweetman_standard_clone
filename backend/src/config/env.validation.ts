import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET is too short (min 32)'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET is too short (min 32)'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  FRONTEND_ORIGIN: z.string().url().default('http://localhost:3000'),

  S3_BUCKET: z.string().optional(),
  AWS_REGION: z.string().optional(),
  STORAGE_LOCAL_DIR: z.string().optional(),

  BUGSNAG_API_KEY: z.string().optional(),
  APP_VERSION: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment (.env):\n${issues}`)
  }
  return parsed.data
}
