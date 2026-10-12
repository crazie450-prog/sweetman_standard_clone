import { ConfigService } from '@nestjs/config'
import { validateEnv, type AppConfig, type Env } from '../src/config/env.validation'

export function configWith(overrides: Record<string, string | undefined> = {}): AppConfig {
  const config = new ConfigService<Env, true>(validateEnv({ ...process.env, ...overrides }))
  Object.assign(config, { skipProcessEnv: true })
  return config
}
