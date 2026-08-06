import { Injectable, Logger, Module } from '@nestjs/common'
import Bugsnag from '@bugsnag/js'

@Injectable()
export class ErrorReporterService {
  private readonly log = new Logger('ErrorReporter')
  private readonly enabled: boolean

  constructor() {
    const apiKey = process.env.BUGSNAG_API_KEY
    this.enabled = Boolean(apiKey)
    if (this.enabled) {
      Bugsnag.start({
        apiKey: apiKey!,
        releaseStage: process.env.NODE_ENV ?? 'development',
        enabledReleaseStages: ['production', 'staging'],
        appVersion: process.env.APP_VERSION,
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

@Module({ providers: [ErrorReporterService], exports: [ErrorReporterService] })
export class ObservabilityModule {}
