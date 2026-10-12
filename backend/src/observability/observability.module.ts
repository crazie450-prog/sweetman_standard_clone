import { Module } from '@nestjs/common'
import { ErrorReporterService } from './error-reporter.service'

@Module({ providers: [ErrorReporterService], exports: [ErrorReporterService] })
export class ObservabilityModule {}
