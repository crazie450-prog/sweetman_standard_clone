/* Runs the Nexus backend's own extraction on the test documents and writes one result file per document and run,
 * in the format the scorer reads (docs/RESULTS_FORMAT.md).
 *
 * Usage, from the backend folder (so its tsconfig and node_modules apply):
 *   DOCUMENT_EXTRACTOR=gemini GEMINI_API_KEY=... \
 *   npx tsx <tests>/adapters/nexus-backend/export-results.ts <tests>/cases_open_raw.json <tests>/out/<run name> [runs=3] [parallel=3]
 * Optional: NEXUS_BACKEND=<backend folder> when not run from it; ONLY=case1,case2 to run a subset. Finished jobs are
 * skipped, so an interrupted run can be resumed.
 *
 * This mirrors backend/test/extraction-benchmark.ts and the document queue (prepareInput -> extract -> readExtracted
 * -> withUnitCodes -> nestSubRecipes). It was written against the feature/sprint3 branch of October 26, 2026.
 * THE TEAM OWNS THIS FILE: keep it in step with what the review screen really shows. In particular, fill in
 * reviewFlag() below once the application marks lines for review; until then every wrong line counts as unflagged.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { createRequire } from 'node:module'

const BACKEND = resolve(process.env.NEXUS_BACKEND ?? process.cwd())
const req = createRequire(resolve(BACKEND, 'package.json'))
const ex = req(resolve(BACKEND, 'src/modules/documents/extraction'))
const schema = req(resolve(BACKEND, 'src/modules/documents/payload.schema'))

const [casesFile, outDir, runsArg, parArg] = process.argv.slice(2)
if (!casesFile || !outDir) {
  console.error('usage: export-results.ts <cases.json> <outdir> [runs] [parallel]')
  process.exit(2)
}
const RUNS = Number(runsArg ?? 3)
const PAR = Number(parArg ?? 3)
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null

function buildExtractor() {
  const mode = (process.env.DOCUMENT_EXTRACTOR ?? '').toLowerCase()
  if ((mode === 'gemini' || mode === 'ai') && process.env.GEMINI_API_KEY)
    return new ex.GeminiExtractor({
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash',
      segments: process.env.DOCUMENT_SEGMENTS === 'true',
    })
  if (mode === 'claude' && process.env.ANTHROPIC_API_KEY)
    return new ex.ClaudeExtractor({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-5-5',
      effort: process.env.ANTHROPIC_EFFORT ?? 'low',
    })
  if (mode === 'stub') return new ex.StubExtractor()
  console.error('Set DOCUMENT_EXTRACTOR=gemini with GEMINI_API_KEY, or DOCUMENT_EXTRACTOR=claude with ANTHROPIC_API_KEY.')
  process.exit(2)
}

/** Return a short reason when the application would mark this line for review before it can be confirmed, else null.
 *  The delivered payload has no such marker, so this returns null. Wire it to the real review flags when they exist. */
function reviewFlag(_line: any, _payload: any): string | null {
  return null
}

const recipeLine = (l: any, p: any) => {
  const reason = reviewFlag(l, p)
  return {
    name: l.rawName,
    quantity: l.amountMissing ? null : l.quantity ?? null,
    unit: l.amountMissing ? null : l.unit || null,
    quantity_text: l.quantityText ?? null,
    needs_review: reason !== null,
    review_reason: reason,
  }
}

function toResult(type: string, payloads: any[]) {
  if (type === 'recipe')
    return {
      recipes: payloads.map((p) => ({
        title: p.name,
        // a sub-recipe's lines are scored with the recipe that holds it
        lines: [...(p.items ?? []), ...(p.subRecipes ?? []).flatMap((s: any) => s.items ?? [])].map((l) => recipeLine(l, p)),
      })),
    }
  return {
    invoices: payloads.map((p) => ({
      vendor: p.vendorName ?? null,
      number: p.number ?? null,
      date: p.invoiceDate ?? null,
      lines: (p.items ?? []).map((l: any) => {
        const reason = reviewFlag(l, p)
        return {
          name: l.rawName,
          sku: l.sku ?? null,
          quantity: l.quantity ?? null,
          unit: l.unit || null,
          unit_price: l.unitPrice ?? null,
          line_total: l.lineTotal ?? null,
          kind: l.kind === 'charge' ? 'fee' : l.kind === 'credit' ? 'credit' : 'item',
          needs_review: reason !== null,
          review_reason: reason,
        }
      }),
    })),
  }
}

async function job(extractor: any, c: { id: string; path: string; type: string }, run: number) {
  const file = resolve(outDir, `${c.id}__${run}.json`)
  if (existsSync(file)) return
  const rec: any = { format: 'nexus-results-v1', case: c.id, run, type: c.type }
  const t0 = Date.now()
  try {
    const input = await ex.prepareInput({ type: c.type, fileName: basename(c.path), mimeType: '', buffer: readFileSync(c.path) })
    let payloads: any[] = []
    try {
      const results = await extractor.extract(input)
      payloads = results
        .filter((r: any) => !r.refused)
        .map((r: any) => schema.withUnitCodes(schema.readExtracted(r.payload, c.type)))
      if (c.type === 'recipe') payloads = schema.nestSubRecipes(payloads)
      rec.models = [...new Set(results.map((r: any) => r.readBy?.model).filter(Boolean))]
    } catch (e) {
      if (!(e instanceof ex.ExtractionRefused)) throw e // "not this type", cut short: the application imports nothing
      rec.refused = String((e as Error).message).slice(0, 200)
    }
    Object.assign(rec, toResult(c.type, payloads))
  } catch (e) {
    rec.error = String((e as Error)?.message ?? e).replace(/key=[^&\s"]+/g, 'key=***').slice(0, 600)
  }
  rec.ms = Date.now() - t0
  writeFileSync(file, JSON.stringify(rec, null, 1))
  console.log(`${c.id}#${run} ${rec.error ? 'ERR ' + rec.error.slice(0, 100) : 'ok'} ${rec.ms}ms`)
}

;(async () => {
  mkdirSync(outDir, { recursive: true })
  const cases = (JSON.parse(readFileSync(casesFile, 'utf8')) as { id: string; path: string; type: string }[]).filter(
    (c) => !only || only.has(c.id),
  )
  const extractor = buildExtractor()
  const queue = cases.flatMap((c) => Array.from({ length: RUNS }, (_, i) => [c, i + 1] as const))
  let i = 0
  await Promise.all(
    Array.from({ length: PAR }, async () => {
      while (i < queue.length) {
        const [c, r] = queue[i++]
        await job(extractor, c, r)
      }
    }),
  )
  console.log(`done: ${queue.length} jobs in ${outDir}`)
})()
