import { UnitsModule } from '../units/units.module'
import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppConfig } from '../../config/env.validation'
import { extractorChoice } from '../../config/integrations'
import { StorageModule } from '../../storage/storage.module'
import {
  DOCUMENT_EXTRACTOR,
  StubExtractor,
  ClaudeExtractor,
  GeminiExtractor,
  PairExtractor,
  type DocumentExtractor,
} from './extraction'
import { DocumentsQueue, DocumentsWorker } from './documents.queue'
import { CostingModule } from '../../costing/costing.module'
import { DocumentsController } from './documents.controller'
import { DocumentsService } from './documents.service'

@Module({
  imports: [StorageModule, CostingModule, UnitsModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentsQueue,
    DocumentsWorker,
    {
      provide: DOCUMENT_EXTRACTOR,
      inject: [ConfigService],
      useFactory: (config: AppConfig): DocumentExtractor => {
        const choice = extractorChoice(config)
        if (choice === 'gemini') {
          return new GeminiExtractor({
            apiKey: config.getOrThrow('GEMINI_API_KEY', { infer: true }),
            model: config.getOrThrow('GEMINI_MODEL', { infer: true }),
          })
        }
        if (choice === 'pair') {
          return new PairExtractor({
            apiKey: config.getOrThrow('GEMINI_API_KEY', { infer: true }),
            draftModel: config.getOrThrow('GEMINI_DRAFT_MODEL', { infer: true }),
            reviewModel: config.getOrThrow('GEMINI_REVIEW_MODEL', { infer: true }),
          })
        }
        if (choice === 'claude') {
          return new ClaudeExtractor({
            apiKey: config.getOrThrow('ANTHROPIC_API_KEY', { infer: true }),
            model: config.getOrThrow('ANTHROPIC_MODEL', { infer: true }),
            effort: config.getOrThrow('ANTHROPIC_EFFORT', { infer: true }),
          })
        }
        return new StubExtractor()
      },
    },
  ],
  exports: [DocumentsService, DocumentsQueue],
})
export class DocumentsModule {}
