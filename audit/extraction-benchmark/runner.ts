/* Live extraction benchmark runner.
 * Usage: tsx runner.ts <arm> <cases.json> <outdir> <runs> <concurrency>
 * arms: m3-gemini:<model> | m3-pair | m3-claude:<model> | ef-gemini:<model> | ef-claude:<model>
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename } from 'node:path'
import {
  ClaudeExtractor,
  GeminiExtractor,
  PairExtractor,
  prepareInput,
  textChunks,
  type DocumentType,
  type ExtractInput,
  type ExtractionResult,
} from '../../backend/src/modules/documents/extraction'
import {
  nestSubRecipes,
  namedMenu,
  readExtracted,
  withUnitCodes,
  PayloadError,
} from '../../backend/src/modules/documents/payload.schema'
import { normalizeUnit } from '../../backend/src/costing/units'

const [arm, casesFile, outDir, runsArg, concArg] = process.argv.slice(2)
const RUNS = Number(runsArg ?? 5)
const CONC = Number(concArg ?? 4)
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? ''
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? ''
const WORKSPACE = process.env.ANTHROPIC_WORKSPACE_ID ?? ''
const redact = (s: string) =>
  s.split(GEMINI_KEY).join('***').split(ANTHROPIC_KEY).join('***').replace(/key=[^&\s"]+/g, 'key=***')

type Call = { model: string; ms: number; status: number; retries: number; usage?: unknown; modelVersion?: string; finish?: string }

function recordingFetch(calls: Call[]): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    const model = /models\/([^:]+):/.exec(u)?.[1] ?? (JSON.parse(String(init?.body ?? '{}')).model as string) ?? '?'
    const headers = new Headers(init?.headers)
    if (u.includes('anthropic.com') && WORKSPACE) headers.set('anthropic-workspace-id', WORKSPACE)
    let retries = 0
    for (;;) {
      const t0 = Date.now()
      let res: Response
      try {
        res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(240_000) })
      } catch (e) {
        if (retries < 4) { retries++; await new Promise((r) => setTimeout(r, 2000 * 2 ** retries)); continue }
        throw e
      }
      const text = await res.text()
      const ms = Date.now() - t0
      if ((res.status === 429 || res.status >= 500) && retries < 6) {
        retries++
        const after = Number(res.headers.get('retry-after') ?? 0)
        await new Promise((r) => setTimeout(r, Math.max(after * 1000, 2500 * 2 ** retries)))
        continue
      }
      let usage: unknown, modelVersion: string | undefined, finish: string | undefined
      try {
        const j = JSON.parse(text)
        usage = j.usageMetadata ?? j.usage
        modelVersion = j.modelVersion ?? j.model
        finish = j.candidates?.[0]?.finishReason ?? j.stop_reason
      } catch { /* not json */ }
      calls.push({ model, ms, status: res.status, retries, usage, modelVersion, finish })
      return new Response(text, { status: res.status, headers: res.headers })
    }
  }) as typeof fetch
}

/* ---------- M3 post-processing, exactly as documents.queue.ts extractInto() ---------- */
function asQueue(results: ExtractionResult[], type: DocumentType, fileName: string) {
  if (results.length === 0) return { refused: 'No document detected in the file', payloads: [] as unknown[] }
  const readable: ExtractionResult[] = []
  const unreadable: string[] = []
  for (const result of results) {
    try {
      result.payload = withUnitCodes(namedMenu(readExtracted(result.payload, type), fileName))
      readable.push(result)
    } catch (e) {
      if (!(e instanceof PayloadError)) throw e
      unreadable.push(`The extracted values could not be read: ${(e as Error).message}`)
    }
  }
  if (readable.length === 0) return { refused: unreadable[0], payloads: [] }
  const kept = type === 'recipe' ? nestSubRecipes(readable.map((r) => r.payload as never)) : readable.map((r) => r.payload)
  return { refused: null, payloads: kept, unreadable }
}

/* ---------- Evidence-first (proposed) extractor ---------- */
const EF_RECIPE = `You transcribe restaurant recipe documents into JSON. You are a transcriber, not a cook:
never add, complete, correct, convert or standardise anything.

1. ONLY WHAT IS PRINTED. Return a line only for a line printed in an ingredient list of the
   document. Do not add ingredients that appear only in the method or instructions, in a photo,
   in a note, or that recipes like this usually contain. If the document shows no ingredient
   list, return an empty "lines" list. An empty answer is correct; an invented line is a
   serious error.
2. EVIDENCE. For every line, copy into "evidence" the exact characters of that printed line,
   including its amount, unit and any notes, and give "page" (1-based; null for a file without
   pages). Do not fix spelling and do not join two printed lines.
   ONE INGREDIENT PER ENTRY. When one printed line or sentence lists several ingredients
   (separated by commas, "and", "+" or a colon after a component name, for example
   "Sauce: 1 cup soy, 2 tbsp honey, 1 tsp salt"), return one entry for each ingredient, each
   with its own name, amount and unit, and the whole printed line as the evidence of each.
3. VERBATIM FIELDS, NOT NUMBERS.
   - "nameText": the ingredient words exactly as printed ("shallots, minced"), without the
     amount, the unit or any price or cost printed beside it.
   - "quantityText": the amount exactly as printed ("1 1/2", "1/2", "2-3", "200"), or null.
   - "unitText": the unit exactly as printed ("c", "T", "tbsp", "g", "#10 can", "ea"), or null.
   - "amountNote": a printed phrase used instead of an amount ("to taste", "for frying",
     "as needed", "for garnish"), or null.
   Never turn fractions into decimals, never convert units, never compute.
4. NULL, NEVER A GUESS. When something is not printed, return null. Never return 0, 1 or any
   default amount, unit, yield or portion count.
5. SECTIONS AND COMPONENTS. Give each line the heading it is printed under, exactly as printed,
   in "section" (null if none). In "components", list every heading that has its own
   ingredient list: "nameText" as printed, "yieldText" as printed or null, and "usedAsText":
   the exact evidence of the line in another list that uses this component, or null if no
   printed line uses it. Never move a line to another section, never merge or split sections,
   never invent a line for a component.
6. TITLE AND YIELD. "titleText" is the recipe title as printed. "yieldText" and "portionsText"
   are copied exactly as printed, or null. Do not estimate either.
7. SEVERAL RECIPES. Return one entry in "recipes" per separately titled recipe with its own
   ingredient list, with the "pages" it spans. A component used by another recipe in the same
   file is not a separate recipe.
8. LEGIBILITY. If any character of a line is hard to read, still copy your best reading, and
   set "legibility" to "unclear" for that line; otherwise "clear".
9. WRONG DOCUMENT. Set "documentKind" to what the file mainly is. Return an empty "recipes"
   list only when the file contains no ingredient list at all (for example an invoice, a
   schedule, or a menu that only names dishes and prices). A menu, event sheet, prep sheet or
   book chapter that also gives ingredient lists is read as recipes: return every one of them.
10. WORKBOOKS. Text that comes from a workbook arrives one sheet after another under "Sheet:"
   headings. Sheets that hold no recipe (order guides, price lists, tables of contents, prep or
   par sheets, schedules) produce no entry, but every recipe on the other sheets is returned,
   and "documentKind" is "recipe" when any sheet holds one. In a table, take the amount and
   unit from the amount column only; cost and price columns are never amounts.`

const EF_INVOICE = `You transcribe vendor invoices into JSON. You are a transcriber, not an accountant: copy what is
printed; never calculate, convert, normalise, reorder or fill in.

1. ENTRIES. Return one entry per invoice (vendor + invoice number). A continuation page of the
   same invoice belongs to the same entry; list every page it spans in "pages".
2. HEADER, VERBATIM. "vendorText", "invoiceNumberText", "invoiceDateText" exactly as printed
   (for example "03/04/26"), or null.
3. ROWS. Return every printed row of the item table, in printed order, including fees,
   surcharges, deposits, credits, returns and discounts. For each row:
   - "evidence": the whole printed row exactly as on the page; "page".
   - "kind": item | fee | deposit | credit | discount | other.
   - "itemCodeText", "descriptionText" exactly as printed (description null only if none).
   - "qtyOrderedText", "qtyShippedText": as printed, or null.
   - "unitText": the unit-of-measure column as printed ("CS", "EA", "LB", "BX"), or null.
   - "packText": the pack/size as printed ("6/#10", "4/5 LB", "12/1 QT", "25 LB"), or null.
   - "unitPriceText": the per-unit price as printed, or null if the row prints none.
   - "priceUnitText": what the price is per, if printed ("/LB", "per CS"), or null.
   - "weightText": a printed catch weight ("41.6 LB"), or null.
   - "extendedPriceText": the row total as printed, or null.
   - "legibility": "unclear" if any character of the row is hard to read, else "clear".
4. NEVER COMPUTE. If a row prints only a total, unitPriceText is null. Never move a number to
   another column. Keep minus signs, brackets and "CR" exactly as printed.
5. TOTALS, VERBATIM. "subtotalText", "taxText", "otherChargesText", "totalText", or null.
   Subtotal, tax and total rows are not item rows.
6. WRONG DOCUMENT. Set "documentKind" to what the file is; if it is not an invoice, return no
   invoices.`

const S = (nullable = false) => ({ type: 'STRING', ...(nullable ? { nullable: true } : {}) })
const obj = (props: Record<string, unknown>) => ({
  type: 'OBJECT',
  properties: props,
  required: Object.keys(props),
  propertyOrdering: Object.keys(props),
})
const KINDS = ['recipe', 'invoice', 'menu', 'sales_report', 'other']
const EF_RECIPE_SCHEMA = obj({
  documentKind: { type: 'STRING', enum: KINDS },
  recipes: {
    type: 'ARRAY',
    items: obj({
      titleText: S(true),
      yieldText: S(true),
      portionsText: S(true),
      pages: { type: 'ARRAY', items: { type: 'INTEGER' } },
      components: { type: 'ARRAY', items: obj({ nameText: S(), yieldText: S(true), usedAsText: S(true) }) },
      lines: {
        type: 'ARRAY',
        items: obj({
          evidence: S(),
          page: { type: 'INTEGER', nullable: true },
          section: S(true),
          nameText: S(),
          quantityText: S(true),
          unitText: S(true),
          amountNote: S(true),
          legibility: { type: 'STRING', enum: ['clear', 'unclear'] },
        }),
      },
    }),
  },
})
const EF_INVOICE_SCHEMA = obj({
  documentKind: { type: 'STRING', enum: KINDS },
  invoices: {
    type: 'ARRAY',
    items: obj({
      vendorText: S(true),
      invoiceNumberText: S(true),
      invoiceDateText: S(true),
      pages: { type: 'ARRAY', items: { type: 'INTEGER' } },
      rows: {
        type: 'ARRAY',
        items: obj({
          evidence: S(),
          page: { type: 'INTEGER', nullable: true },
          kind: { type: 'STRING', enum: ['item', 'fee', 'deposit', 'credit', 'discount', 'other'] },
          itemCodeText: S(true),
          descriptionText: S(true),
          qtyOrderedText: S(true),
          qtyShippedText: S(true),
          unitText: S(true),
          packText: S(true),
          unitPriceText: S(true),
          priceUnitText: S(true),
          weightText: S(true),
          extendedPriceText: S(true),
          legibility: { type: 'STRING', enum: ['clear', 'unclear'] },
        }),
      },
      subtotalText: S(true),
      taxText: S(true),
      otherChargesText: S(true),
      totalText: S(true),
    }),
  },
})

const lowerTypes = (s: unknown): unknown => {
  if (Array.isArray(s)) return s.map(lowerTypes)
  if (!s || typeof s !== 'object') return s
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s)) {
    if (k === 'propertyOrdering') continue
    if (k === 'nullable') continue
    out[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : lowerTypes(v)
  }
  // JSON-schema nullability for Claude
  if ((s as Record<string, unknown>).nullable) out.type = [String(out.type), 'null']
  if (out.type === 'object') out.additionalProperties = false
  return out
}

const MODEL_READS = /^(image\/|application\/pdf)/

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'

/* EF_IMAGES=1: for a PDF, send its embedded photos at native resolution plus its text layer */
function pdfPhotos(buffer: Buffer): { kind: 'file' | 'text'; data: string; mime?: string }[] {
  const dir = mkdtempSync(`${tmpdir()}/pdfimg-`)
  try {
    const pdf = `${dir}/in.pdf`
    writeFileSync(pdf, buffer)
    execFileSync('pdfimages', ['-png', pdf, `${dir}/img`])
    const seen = new Set<string>()
    const parts: { kind: 'file' | 'text'; data: string; mime?: string }[] = []
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.png')).sort()) {
      const b = readFileSync(`${dir}/${f}`)
      const h = createHash('md5').update(b).digest('hex')
      if (seen.has(h) || b.length < 30_000) continue
      seen.add(h)
      parts.push({ kind: 'file', data: b.toString('base64'), mime: 'image/png' })
    }
    const text = execFileSync('pdftotext', ['-layout', pdf, '-']).toString()
    return [...parts, { kind: 'text', data: `TEXT LAYER OF THE SAME PDF (the photos above are its pages' images):\n${text}` }]
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function efParts(input: ExtractInput): Promise<{ kind: 'file' | 'text'; data: string; mime?: string }[]> {
  if (process.env.EF_IMAGES && input.mimeType === 'application/pdf') {
    const photos = pdfPhotos(input.buffer)
    // auto route: only PDFs that actually carry photos go the photo route; digital PDFs go as-is
    if (process.env.EF_IMAGES !== 'auto' || photos.length > 1) return [{ kind: 'text', data: '__MULTI__' }, ...photos]
  }
  if (MODEL_READS.test(input.mimeType)) return [{ kind: 'file', data: input.buffer.toString('base64'), mime: input.mimeType }]
  const chunks = await textChunks(input)
  // EF_SHEETS=1: one call per workbook sheet, so a non-recipe sheet cannot decide for the others
  const pieces = process.env.EF_SHEETS ? chunks.flatMap((c) => c.split(/\n\n(?=Sheet: )/)) : chunks
  return pieces.map((t) => ({ kind: 'text' as const, data: t }))
}

async function efGemini(model: string, input: ExtractInput, f: typeof fetch): Promise<unknown[]> {
  const out: unknown[] = []
  const recipe = input.type === 'recipe'
  const allParts = await efParts(input)
  const multi = allParts[0]?.data === '__MULTI__'
  const groups = multi ? [allParts.slice(1)] : allParts.map((p) => [p])
  const answers = await Promise.all(groups.map(async (group) => {
    const file = group.map((part) => (part.kind === 'file' ? { inline_data: { mime_type: part.mime, data: part.data } } : { text: multi ? part.data : `DOCUMENT:\n${part.data}` }))
    const body = {
      systemInstruction: { parts: [{ text: recipe ? EF_RECIPE : EF_INVOICE }] },
      contents: [{ role: 'user', parts: [...file, { text: `Transcribe the ${recipe ? 'recipe' : 'invoice'} document above following the rules.` }] }],
      generationConfig: {
        ...(process.env.EF_MEDIA ? { mediaResolution: `MEDIA_RESOLUTION_${process.env.EF_MEDIA}` } : {}),
        responseMimeType: 'application/json',
        responseSchema: recipe ? EF_RECIPE_SCHEMA : EF_INVOICE_SCHEMA,
        thinkingConfig: { thinkingLevel: 'low' },
        maxOutputTokens: 32768,
      },
    }
    const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`)
    const j = JSON.parse(text)
    const t = (j.candidates?.[0]?.content?.parts ?? []).filter((p: { thought?: boolean; text?: string }) => !p.thought && p.text).map((p: { text: string }) => p.text).join('')
    if (!t) throw new Error(`Gemini returned no content (${j.candidates?.[0]?.finishReason})`)
    return JSON.parse(t)
  }))
  out.push(...answers)
  return out
}

// Claude structured outputs allow at most 16 nullable fields: page and description become required on invoices
function claudeSchema(recipe: boolean): unknown {
  const sc = lowerTypes(recipe ? EF_RECIPE_SCHEMA : EF_INVOICE_SCHEMA) as any
  if (!recipe) {
    const row = sc.properties.invoices.items.properties.rows.items.properties
    row.page.type = 'integer'
    row.descriptionText.type = 'string'
  }
  return sc
}

async function efClaude(model: string, input: ExtractInput, f: typeof fetch): Promise<unknown[]> {
  const out: unknown[] = []
  const recipe = input.type === 'recipe'
  const allParts = await efParts(input)
  const multi = allParts[0]?.data === '__MULTI__'
  const groups = multi ? [allParts.slice(1)] : allParts.map((p) => [p])
  const answers = await Promise.all(groups.map(async (group) => {
    const file = group.map((part) =>
      part.kind === 'text'
        ? { type: 'text', text: multi ? part.data : `DOCUMENT:\n${part.data}` }
        : part.mime === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: part.data } }
          : { type: 'image', source: { type: 'base64', media_type: part.mime, data: part.data } })
    const body = {
      model,
      max_tokens: 32000,
      system: recipe ? EF_RECIPE : EF_INVOICE,
      messages: [{ role: 'user', content: [...file, { type: 'text', text: `Transcribe the ${recipe ? 'recipe' : 'invoice'} document above following the rules.` }] }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: claudeSchema(recipe) } },
    }
    const res = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Claude ${res.status}: ${text.slice(0, 300)}`)
    const j = JSON.parse(text)
    const t = (j.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('')
    return JSON.parse(t)
  }))
  out.push(...answers)
  return out
}

/* ---------- jobs ---------- */
type Case = { id: string; path: string; type: DocumentType }
const cases: Case[] = JSON.parse(readFileSync(casesFile, 'utf8'))
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

async function job(c: Case, run: number) {
  const file = `${outDir}/${c.id}__${run}.json`
  if (existsSync(file)) return
  const calls: Call[] = []
  const f = recordingFetch(calls)
  const input = await prepareInput({ type: c.type, fileName: basename(c.path), mimeType: '', buffer: readFileSync(c.path) })
  const t0 = Date.now()
  const rec: Record<string, unknown> = { arm, case: c.id, run, type: c.type }
  try {
    const [kind, model] = arm.split(':')
    if (kind === 'm3-gemini' || kind === 'm3-pair' || kind === 'm3-claude') {
      const ex =
        kind === 'm3-gemini'
          ? new GeminiExtractor({ apiKey: GEMINI_KEY, model, fetch: f })
          : kind === 'm3-pair'
            ? new PairExtractor({ apiKey: GEMINI_KEY, draftModel: 'gemini-3.5-flash-lite', reviewModel: 'gemini-3.8-flash', fetch: f, warn: (m) => ((rec.warn ??= []) as string[]).push(m) })
            : new ClaudeExtractor({ apiKey: ANTHROPIC_KEY, model, effort: 'low', fetch: f })
      const results = await ex.extract(input)
      rec.raw = JSON.parse(JSON.stringify(results))
      Object.assign(rec, asQueue(results, c.type, basename(c.path)))
    } else if (kind === 'ef-gemini') {
      rec.ef = await efGemini(model, input, f)
    } else if (kind === 'ef-claude') {
      rec.ef = await efClaude(model, input, f)
    } else throw new Error(`unknown arm ${arm}`)
  } catch (e) {
    rec.error = redact(String((e as Error)?.message ?? e)).slice(0, 600)
  }
  rec.ms = Date.now() - t0
  rec.calls = calls
  writeFileSync(file, JSON.stringify(rec, null, 1))
  process.stdout.write(`${c.id}#${run} ${rec.error ? 'ERR ' + String(rec.error).slice(0, 120) : 'ok'} ${rec.ms}ms\n`)
}

;(async () => {
  const queue: [Case, number][] = []
  for (let r = 1; r <= RUNS; r++) for (const c of cases) if (!only || only.has(c.id)) queue.push([c, r])
  let i = 0
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (i < queue.length) {
        const [c, r] = queue[i++]
        await job(c, r)
      }
    }),
  )
  void normalizeUnit
})()
