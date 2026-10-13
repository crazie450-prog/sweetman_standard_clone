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
      ...(process.env.GEMINI_TIER ? { serviceTier: process.env.GEMINI_TIER } : {}),
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

/* ---------- Line-reference (LR) mode: numbered text in, line numbers out ----------
 * For inputs the app can read as text (Word, workbooks, digital PDFs) the model returns line numbers instead of
 * copying evidence; code resolves the numbers to the printed lines, so the proof is exact and output is smaller.
 * Photos and PDFs without a usable text layer (or carrying photos) fall back to the evidence-first route. */
const LR_RULE2 = `2. LINE NUMBERS. The document arrives with a number in square brackets before each printed line
   ("[12] 2 cups sugar"). For every entry give in "lines" the number of the printed line it comes
   from; if its name and its amount are printed on different lines (a table read column by
   column), give both numbers. Never copy the line itself.`
const LR_RECIPE = EF_RECIPE
  .replace(/2\. EVIDENCE\.[\s\S]*?do not join two printed lines\./, LR_RULE2)
  .replace('and the whole printed line as the evidence of each.', 'and the same line number.')
const LR_INVOICE = EF_INVOICE
  .replace('- "evidence": the whole printed row exactly as on the page; "page".', '- "lines": the number(s) of the printed line(s) the row comes from (never copy the row).')
  .replace('copy what is\nprinted;', 'copy what is\nprinted;')
const INTS = { type: 'ARRAY', items: { type: 'INTEGER' } }
const LR_RECIPE_SCHEMA = obj({
  documentKind: { type: 'STRING', enum: KINDS },
  recipes: {
    type: 'ARRAY',
    items: obj({
      titleText: S(true), yieldText: S(true), portionsText: S(true),
      components: { type: 'ARRAY', items: obj({ nameText: S(), yieldText: S(true), usedAsText: S(true) }) },
      lines: {
        type: 'ARRAY',
        items: obj({
          lines: INTS, section: S(true), nameText: S(), quantityText: S(true), unitText: S(true), amountNote: S(true),
          legibility: { type: 'STRING', enum: ['clear', 'unclear'] },
        }),
      },
    }),
  },
})
const LR_INVOICE_SCHEMA = obj({
  documentKind: { type: 'STRING', enum: KINDS },
  invoices: {
    type: 'ARRAY',
    items: obj({
      vendorText: S(true), invoiceNumberText: S(true), invoiceDateText: S(true),
      rows: {
        type: 'ARRAY',
        items: obj({
          lines: INTS,
          kind: { type: 'STRING', enum: ['item', 'fee', 'deposit', 'credit', 'discount', 'other'] },
          itemCodeText: S(true), descriptionText: S(), qtyOrderedText: S(true), qtyShippedText: S(true),
          unitText: S(true), packText: S(true), unitPriceText: S(true), priceUnitText: S(true), weightText: S(true),
          extendedPriceText: S(true), legibility: { type: 'STRING', enum: ['clear', 'unclear'] },
        }),
      },
      subtotalText: S(true), taxText: S(true), otherChargesText: S(true), totalText: S(true),
    }),
  },
})

/* LR_CHUNK=<chars>: split a long text at blank lines into pieces of about that size, read them in parallel and
 * stitch recipes back together (line numbers stay global, so proof and order are preserved). */
function splitLong(text: string, size: number): string[] {
  if (!size || text.length <= size * 1.3) return [text]
  const blocks = text.split(/\n\s*\n/)
  const parts: string[] = []
  let cur = ''
  for (const b of blocks) {
    if (cur && cur.length + b.length > size) { parts.push(cur); cur = '' }
    cur += (cur ? '\n\n' : '') + b
  }
  if (cur) parts.push(cur)
  return parts
}

/* LR_COMPACT=1: one-letter keys in the model's output (recipes), mapped back in code. */
const CK: Record<string, string> = { t: 'titleText', y: 'yieldText', p: 'portionsText', c: 'components', i: 'lines', n: 'nameText', w: 'usedAsText', l: 'lines', s: 'section', q: 'quantityText', u: 'unitText', a: 'amountNote', g: 'legibility', k: 'documentKind', r: 'recipes' }
const LR_COMPACT_NOTE = `\n\nOUTPUT KEYS. To keep the answer short, the JSON uses one-letter keys: k = documentKind, r = recipes;
in a recipe t = titleText, y = yieldText, p = portionsText, c = components, i = its ingredient entries;
in a component n = nameText, y = yieldText, w = usedAsText; in an ingredient entry l = lines, s = section,
n = nameText, q = quantityText, u = unitText, a = amountNote, g = legibility ("c" clear, "u" unclear).`
const compactSchema = () => {
  const o = (props: Record<string, unknown>) => ({ type: 'OBJECT', properties: props, required: Object.keys(props), propertyOrdering: Object.keys(props) })
  return o({
    k: { type: 'STRING', enum: KINDS },
    r: { type: 'ARRAY', items: o({
      t: S(true), y: S(true), p: S(true),
      c: { type: 'ARRAY', items: o({ n: S(), y: S(true), w: S(true) }) },
      i: { type: 'ARRAY', items: o({ l: INTS, s: S(true), n: S(), q: S(true), u: S(true), a: S(true), g: { type: 'STRING', enum: ['c', 'u'] } }) },
    }) },
  })
}
function expandCompact(x: any): any {
  if (Array.isArray(x)) return x.map(expandCompact)
  if (!x || typeof x !== 'object') return x
  const out: any = {}
  for (const [k, v] of Object.entries(x)) out[CK[k] ?? k] = k === 'g' ? (v === 'u' ? 'unclear' : 'clear') : expandCompact(v)
  return out
}

function numbered(text: string, start = 0): { body: string; byId: Map<number, string> } {
  const byId = new Map<number, string>()
  const out: string[] = []
  let n = start
  for (const raw of text.replace(/\f/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue
    n += 1
    byId.set(n, line)
    out.push(`[${n}] ${line}`)
  }
  return { body: out.join('\n'), byId }
}

async function lrTexts(input: ExtractInput): Promise<string[] | null> {
  if (input.mimeType.startsWith('image/')) return null
  if (input.mimeType === 'application/pdf') {
    const photos = pdfPhotos(input.buffer)
    if (photos.length > 1) return null // carries photos: evidence route with the photos
    const layer = photos[photos.length - 1]?.data.replace(/^TEXT LAYER[^\n]*\n/, '') ?? ''
    if (layer.replace(/\s/g, '').length < 80) return null // a scan: no text to point at
    return [layer]
  }
  const chunks = await textChunks(input)
  return process.env.EF_SHEETS ? chunks.flatMap((c) => c.split(/\n\n(?=Sheet: )/)) : chunks
}

function resolveLines(answer: any, byId: Map<number, string>, recipe: boolean) {
  const ev = (ids: unknown) =>
    (Array.isArray(ids) ? ids : []).map((i) => byId.get(Number(i)) ?? '').filter(Boolean).join(' | ')
  if (recipe) for (const r of answer?.recipes ?? []) for (const l of r.lines ?? []) { l.evidence = ev(l.lines); l.page = null }
  else for (const inv of answer?.invoices ?? []) for (const row of inv.rows ?? []) { row.evidence = ev(row.lines); row.page = null }
  return answer
}

function mergeChunks(answers: any[], recipe: boolean): any {
  if (!recipe) return answers
  const recipes: any[] = []
  for (const a of answers) {
    for (const [i, r] of (a?.recipes ?? []).entries()) {
      if (i === 0 && !r.titleText && recipes.length) {
        const prev = recipes[recipes.length - 1]
        prev.lines = [...(prev.lines ?? []), ...(r.lines ?? [])]
        prev.components = [...(prev.components ?? []), ...(r.components ?? [])]
      } else recipes.push(r)
    }
  }
  return [{ documentKind: answers.find((a) => a?.documentKind === 'recipe') ? 'recipe' : answers[0]?.documentKind, recipes }]
}

/* LR_OUTLINE=1 (with LR_CHUNK): a small first call lists the line where each recipe begins, and the long text is
 * split only at those lines, so no recipe is cut in two. Pieces keep the global line numbers. */
const OUTLINE_PROMPT = `The document arrives with a number in square brackets before each printed line. Give the number
of the line where each recipe begins: the dish's title line (or its first line when it has no title). A step,
part or component inside a recipe ("Step 2", "For the sauce") is not a new recipe. Give the numbers in order.`
async function outlineStarts(nb: { body: string }, f: typeof fetch): Promise<number[]> {
  const body = {
    systemInstruction: { parts: [{ text: OUTLINE_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: `DOCUMENT:\n${nb.body}` }] }],
    ...(process.env.GEMINI_TIER ? { serviceTier: process.env.GEMINI_TIER } : {}),
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: obj({ starts: INTS }),
      thinkingConfig: { thinkingLevel: 'minimal' },
    },
  }
  const model = process.env.LR_OUTLINE_MODEL ?? 'gemini-3.5-flash-lite'
  const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const raw = await res.text()
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${raw.slice(0, 300)}`)
  const t = (JSON.parse(raw).candidates?.[0]?.content?.parts ?? []).filter((p: { thought?: boolean; text?: string }) => !p.thought && p.text).map((p: { text: string }) => p.text).join('')
  return (JSON.parse(t).starts ?? []).map(Number).filter((n: number) => Number.isInteger(n))
}
function splitAtStarts(nb: { body: string; byId: Map<number, string> }, starts: number[], size: number) {
  const cut = new Set(starts)
  const segs: string[][] = [[]]
  for (const line of nb.body.split('\n')) {
    const id = Number(line.slice(1, line.indexOf(']')))
    if (cut.has(id) && segs[segs.length - 1].length) segs.push([])
    segs[segs.length - 1].push(line)
  }
  const groups: string[][] = []
  let cur: string[] = []
  let len = 0
  for (const s of segs) {
    const n = s.join('\n').length
    if (cur.length && len + n > size) { groups.push(cur); cur = []; len = 0 }
    cur.push(...s)
    len += n + 1
  }
  if (cur.length) groups.push(cur)
  return groups.map((g) => ({ body: g.join('\n'), byId: nb.byId }))
}

async function lrGemini(model: string, input: ExtractInput, f: typeof fetch): Promise<unknown[]> {
  const texts = await lrTexts(input)
  if (!texts) return efGemini(model, input, f)
  const recipe = input.type === 'recipe'
  const size = Number(process.env.LR_CHUNK ?? 0)
  if (process.env.LR_OUTLINE && recipe) {
    return Promise.all(texts.map(async (whole) => {
      const nb = numbered(whole)
      if (!size || nb.body.length <= size * 1.3) return lrGeminiCall(model, nb, recipe, f)
      const groups = splitAtStarts(nb, await outlineStarts(nb, f), size)
      const answers: any[] = await Promise.all(groups.map((g) => lrGeminiCall(model, g, recipe, f)))
      return { documentKind: answers.find((a) => a?.documentKind === 'recipe') ? 'recipe' : answers[0]?.documentKind, recipes: answers.flatMap((a) => a?.recipes ?? []) }
    }))
  }
  const results = await Promise.all(texts.map(async (whole) => {
    const pieces = recipe ? splitLong(whole, size) : [whole]
    let start = 0
    const jobs = pieces.map((piece, k) => {
      const nb = numbered(piece, start)
      start += nb.byId.size
      return lrGeminiCall(model, nb, recipe, f, pieces.length > 1 ? k + 1 : 0, pieces.length)
    })
    const answers = await Promise.all(jobs)
    return pieces.length > 1 ? mergeChunks(answers, recipe)[0] : answers[0]
  }))
  return results
}

async function lrGeminiCall(model: string, nb: { body: string; byId: Map<number, string> }, recipe: boolean, f: typeof fetch, part = 0, of = 1): Promise<unknown> {
  {
    const { body: doc, byId } = nb
    const partNote = part
      ? `This is part ${part} of ${of} of a longer document. If the part begins in the middle of a recipe, return those lines in a first recipe with titleText null.\n`
      : ''
    const body = {
      systemInstruction: { parts: [{ text: recipe ? LR_RECIPE + (process.env.LR_COMPACT ? LR_COMPACT_NOTE : '') : LR_INVOICE }] },
      contents: [{ role: 'user', parts: [{ text: `${partNote}DOCUMENT:\n${doc}` }, { text: `Transcribe the ${recipe ? 'recipe' : 'invoice'} document above following the rules.` }] }],
      ...(process.env.GEMINI_TIER ? { serviceTier: process.env.GEMINI_TIER } : {}),
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: recipe ? (process.env.LR_COMPACT ? compactSchema() : LR_RECIPE_SCHEMA) : LR_INVOICE_SCHEMA,
        thinkingConfig: { thinkingLevel: process.env.LR_THINK ?? 'low' },
        maxOutputTokens: 32768,
      },
    }
    const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const raw = await res.text()
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${raw.slice(0, 300)}`)
    const j = JSON.parse(raw)
    const t = (j.candidates?.[0]?.content?.parts ?? []).filter((p: { thought?: boolean; text?: string }) => !p.thought && p.text).map((p: { text: string }) => p.text).join('')
    if (!t) throw new Error(`Gemini returned no content (${j.candidates?.[0]?.finishReason})`)
    const parsed = recipe && process.env.LR_COMPACT ? expandCompact(JSON.parse(t)) : JSON.parse(t)
    return resolveLines(parsed, byId, recipe)
  }
}

function lrClaudeSchema(recipe: boolean): unknown {
  return lowerTypes(recipe ? LR_RECIPE_SCHEMA : LR_INVOICE_SCHEMA)
}

async function lrClaude(model: string, input: ExtractInput, f: typeof fetch): Promise<unknown[]> {
  const texts = await lrTexts(input)
  if (!texts) return efClaude(model, input, f)
  const recipe = input.type === 'recipe'
  return Promise.all(texts.map(async (text) => {
    const { body: doc, byId } = numbered(text)
    const prompt = recipe ? LR_RECIPE : LR_INVOICE
    const body: Record<string, unknown> = {
      model,
      max_tokens: 32000,
      system: process.env.CL_CACHE ? [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }] : prompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: `DOCUMENT:\n${doc}` }, { type: 'text', text: `Transcribe the ${recipe ? 'recipe' : 'invoice'} document above following the rules.` }] }],
      output_config: { effort: process.env.CL_EFFORT ?? 'low', format: { type: 'json_schema', schema: lrClaudeSchema(recipe) } },
      ...(process.env.CL_THINK === 'disabled' ? { thinking: { type: 'disabled' } } : {}),
    }
    const res = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    })
    const raw = await res.text()
    if (!res.ok) throw new Error(`Claude ${res.status}: ${raw.slice(0, 300)}`)
    const j = JSON.parse(raw)
    const t = (j.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('')
    return resolveLines(JSON.parse(t), byId, recipe)
  }))
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
  const rec: Record<string, unknown> = {
    arm, case: c.id, run, type: c.type,
    settings: Object.fromEntries(['EF_SHEETS', 'EF_IMAGES', 'EF_MEDIA', 'LR_THINK', 'LR_CHUNK', 'LR_OUTLINE', 'LR_COMPACT', 'GEMINI_TIER', 'CL_THINK', 'CL_CACHE', 'CL_EFFORT'].map((k) => [k, process.env[k] ?? null])),
  }
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
    } else if (kind === 'lr-gemini') {
      rec.ef = await lrGemini(model, input, f)
    } else if (kind === 'lr-claude') {
      rec.ef = await lrClaude(model, input, f)
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
