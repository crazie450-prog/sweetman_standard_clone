import 'dotenv/config'
import { extractorChoice } from '../src/config/integrations'
import {
  StubExtractor,
  GeminiExtractor,
  PairExtractor,
  ClaudeExtractor,
  type DocumentExtractor,
} from '../src/modules/documents/extraction'
import {
  scoreExtraction,
  accuracy,
  type FieldScore,
} from '../src/modules/documents/extraction-score'
import { FIXTURES } from './extraction-fixtures'
import { configWith } from './config'

function buildExtractor(): { mode: string; extractor: DocumentExtractor } {
  const config = configWith()
  const mode = extractorChoice(config)
  const gemini = config.get('GEMINI_API_KEY', { infer: true })
  const claude = config.get('ANTHROPIC_API_KEY', { infer: true })
  if (mode === 'gemini' && gemini) {
    return {
      mode,
      extractor: new GeminiExtractor({
        apiKey: gemini,
        model: config.getOrThrow('GEMINI_MODEL', { infer: true }),
      }),
    }
  }
  if (mode === 'pair' && gemini) {
    return {
      mode,
      extractor: new PairExtractor({
        apiKey: gemini,
        draftModel: config.getOrThrow('GEMINI_DRAFT_MODEL', { infer: true }),
        reviewModel: config.getOrThrow('GEMINI_REVIEW_MODEL', { infer: true }),
      }),
    }
  }
  if (mode === 'claude' && claude) {
    return {
      mode,
      extractor: new ClaudeExtractor({
        apiKey: claude,
        model: config.getOrThrow('ANTHROPIC_MODEL', { infer: true }),
        effort: config.getOrThrow('ANTHROPIC_EFFORT', { infer: true }),
      }),
    }
  }
  return { mode: 'stub', extractor: new StubExtractor() }
}

async function main() {
  const { mode, extractor } = buildExtractor()
  console.log(`\nExtraction benchmark — extractor: ${mode}\n`)

  const totals: FieldScore = { total: 0, correct: 0 }
  for (const fx of FIXTURES) {
    try {
      const results = await extractor.extract(fx.input)
      const score = scoreExtraction(fx.expected, results[0]?.payload)
      totals.total += score.total
      totals.correct += score.correct
      const pct = accuracy(score)
      console.log(
        `  ${(pct * 100).toFixed(0).padStart(3)}%  ${fx.name}  (${score.correct}/${score.total})`,
      )
    } catch (err) {
      const missed = scoreExtraction(fx.expected, undefined)
      totals.total += missed.total
      console.log(`     0%  ${fx.name}  (0/${missed.total})  — ${(err as Error).message}`)
    }
  }

  console.log(
    `\n  overall: ${(accuracy(totals) * 100).toFixed(1)}%  (${totals.correct}/${totals.total} fields)\n`,
  )
}

void main()
