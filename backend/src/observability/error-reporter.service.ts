import Bugsnag from '@bugsnag/js'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { appEnv, errorReporterChoice } from '../config/integrations'
import type { AppConfig } from '../config/env.validation'

@Injectable()
export class ErrorReporterService {
  private readonly log = new Logger('ErrorReporter')
  private readonly enabled: boolean

  constructor(@Inject(ConfigService) config: AppConfig) {
    const apiKey = config.get('BUGSNAG_API_KEY', { infer: true })
    this.enabled = errorReporterChoice(config) === 'bugsnag' && Boolean(apiKey)
    if (this.enabled) {
      Bugsnag.start({
        apiKey: apiKey!,
        releaseStage: appEnv(config),
        enabledReleaseStages: ['production', 'staging'],
        appVersion: config.get('APP_VERSION', { infer: true }),
      })
      this.log.log('BugSnag enabled')
    }
  }

  notify(error: unknown, meta?: { path?: string; method?: string; organizationId?: string }) {
    if (!this.enabled) return
    const err = error instanceof Error ? error : new Error(String(error))
    Bugsnag.notify(err, (event) => {
      if (meta) event.addMetadata('request', meta)
    })
  }
}
