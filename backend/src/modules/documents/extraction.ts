import { Injectable, Logger } from '@nestjs/common'
import { Workbook } from 'exceljs'
import JSZip from 'jszip'
import sharp from 'sharp'
import WordExtractor from 'word-extractor'
import { Readable } from 'node:stream'
import { convertQuantity } from '../../costing/units'
import { dayOrderOf, numericDay } from './payload.schema'

/* ===== Extraction payloads ===== */

export interface InvoiceLine {
  rawName: string
  sku?: string
  quantity: number
  unit: string
  unitPrice: number
  lineTotal?: number
}
export interface InvoicePayload {
  kind: 'invoice'
  vendorName?: string
  number?: string
  invoiceDate?: string
  items: InvoiceLine[]
}

export interface SalesLine {
  menuItemName: string
  quantity: number
  unitPrice: number
}
export interface SalesPayload {
  kind: 'sales'
  date?: string
  items: SalesLine[]
}

export interface RecipeLine {
  rawName: string
  quantity: number
  unit: string
  quantityText?: string
}
export interface SubRecipe {
  name: string
  portions?: number
  yieldQty?: number
  yieldUnit?: string
  items: RecipeLine[]
}
export interface RecipePayload extends SubRecipe {
  kind: 'recipe'
  subRecipes?: SubRecipe[]
}

export interface MenuLine {
  name: string
  price: number
  section?: string
}
export interface MenuPayload {
  kind: 'menu'
  name: string
  items: MenuLine[]
}

export type DocumentType = 'invoice' | 'recipe' | 'menu' | 'sales'

export type ExtractionPayload = InvoicePayload | SalesPayload | RecipePayload | MenuPayload

export interface ExtractionResult {
  payload: ExtractionPayload
  confidence: number | null
}

export interface ExtractInput {
  type: DocumentType
  fileName: string
  mimeType: string
  buffer: Buffer
}

export interface DocumentExtractor {
  extract(input: ExtractInput): Promise<ExtractionResult[]>
}

export const DOCUMENT_EXTRACTOR = Symbol('DOCUMENT_EXTRACTOR')

/* ===== Spreadsheet parsing (CSV, XLSX) ===== */

function plainNumber(value: unknown): string {
  let text = String(value ?? '').replace(/[$€£¥₴\s]/g, '')
  const credit = /^\(.*\)$/.test(text) || /^[^-].*-$/.test(text)
  text = text
    .replace(/^\((.*)\)$/, '$1')
    .replace(/-$/, '')
    .replace(/^(usd|eur|gbp|uah)/i, '')
    .replace(/(?:\/|per)[a-z]+\.?$/i, '')
    .replace(/[a-z]+\.?$/i, '')
  const sign = credit && !text.startsWith('-') ? '-' : ''
  if (/^-?\d+,\d{1,2}$/.test(text) || /^-?0,\d+$/.test(text)) return sign + text.replace(',', '.')
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(text))
    return sign + text.replace(/\./g, '').replace(',', '.')
  return text ? sign + text.replace(/,/g, '') : ''
}

function num(value: unknown): number {
  const n = Number(plainNumber(value))
  return Number.isFinite(n) ? n : 0
}

function stated(value: unknown): number | undefined {
  const text = plainNumber(value)
  if (!text) return undefined
  const n = Number(text)
  return Number.isFinite(n) ? n : undefined
}

const SUMMARY_ROW =
  /^(?:sub[\s-]?total|grand\s+total|invoice\s+total|total(?:\s+(?:due|amount|sales))?|amount\s+due|balance(?:\s+due)?|(?:sales\s+)?tax(?:es)?|vat|gst|hst|pst|tips?|gratuity)(?:\s*\(?\s*[\d.,]+\s*%\s*\)?)?\s*:?$/i

const isSummaryRow = (name: string) => SUMMARY_ROW.test(name)

const blank = (cell: unknown) => plainNumber(cell) === ''

const CURRENCY = /^(usd|eur|gbp|uah)$/i

function unitAfter(cell: unknown, marked: boolean): string {
  const m = (
    marked ? /\d\s*(?:\/|\bper\s+)\s*([a-z][a-z ]*?)\.?\s*$/i : /\d\s*([a-z][a-z ]*?)\.?\s*$/i
  ).exec(String(cell ?? '').trim())
  return m && !CURRENCY.test(m[1]) ? m[1].trim() : ''
}

function pricedPer(price: number, priceUnit: string, lineUnit: string): number {
  if (!priceUnit || !lineUnit) return price
  const share = convertQuantity(1, lineUnit, priceUnit)
  return share === null ? price : Number((price * share).toPrecision(12))
}

const sameText = (a: unknown, b: unknown) =>
  String(a ?? '')
    .trim()
    .toLowerCase() ===
  String(b ?? '')
    .trim()
    .toLowerCase()

function header(row: unknown[]): Map<string, number> {
  const map = new Map<string, number>()
  row.forEach((cell, i) => {
    const key = String(cell ?? '')
      .trim()
      .toLowerCase()
    if (key) map.set(key, i)
  })
  return map
}

const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  csv: 'text/csv',
  json: 'application/json',
}

const extensionOf = (fileName: string): string => fileName.split('.').pop()?.toLowerCase() ?? ''

export async function prepareInput(input: ExtractInput): Promise<ExtractInput> {
  const generic = !input.mimeType || input.mimeType === 'application/octet-stream'
  const mimeType = (generic && TYPE_BY_EXTENSION[extensionOf(input.fileName)]) || input.mimeType
  if (mimeType !== 'image/avif') return { ...input, mimeType }
  try {
    return { ...input, mimeType: 'image/png', buffer: await sharp(input.buffer).png().toBuffer() }
  } catch (e) {
    throw unreadable(input, (e as Error).message)
  }
}

export function looksTabular(input: ExtractInput): boolean {
  return (
    input.mimeType.includes('csv') ||
    input.mimeType.includes('sheet') ||
    /\.(csv|xlsx)$/i.test(input.fileName)
  )
}

export class ExtractionRefused extends Error {}

function unreadable(input: ExtractInput, reason: string): Error {
  return new ExtractionRefused(`Could not read ${input.fileName}: ${reason}`)
}

interface Sheet {
  name: string
  rows: unknown[][]
}

function plainCell(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || value instanceof Date) return value
  const cell = value as {
    result?: unknown
    richText?: { text: string }[]
    text?: unknown
    error?: unknown
  }
  if ('richText' in cell && Array.isArray(cell.richText))
    return cell.richText.map((run) => run.text).join('')
  if ('text' in cell) return plainCell(cell.text)
  if ('formula' in cell || 'sharedFormula' in cell) return plainCell(cell.result ?? null)
  return null
}

function csvText(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(buffer.subarray(2))
  if (buffer[0] === 0xfe && buffer[1] === 0xff)
    return new TextDecoder('utf-16be').decode(buffer.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

function delimiterOf(text: string): string {
  const lines = text
    .slice(0, 4096)
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 5)
  const count = (sep: string) =>
    lines.reduce((n, l) => n + l.replace(/"[^"]*"/g, '').split(sep).length - 1, 0)
  return [',', ';', '\t'].reduce((best, sep) => (count(sep) > count(best) ? sep : best), ',')
}

async function readSheets(input: ExtractInput): Promise<Sheet[]> {
  const wb = new Workbook()
  const isCsv = input.mimeType.includes('csv') || input.fileName.toLowerCase().endsWith('.csv')
  try {
    if (isCsv) {
      const text = csvText(input.buffer)
      await wb.csv.read(Readable.from(Buffer.from(text, 'utf8')), {
        map: (value: unknown) => value,
        parserOptions: { delimiter: delimiterOf(text) },
      })
    } else {
      await wb.xlsx.load(input.buffer as unknown as ArrayBuffer)
    }
  } catch (e) {
    throw unreadable(input, (e as Error).message)
  }
  return wb.worksheets.map((sheet) => {
    const rows: unknown[][] = []
    sheet.eachRow((row) => {
      const values = row.values as unknown[]
      rows.push(
        Array.isArray(values)
          ? values.slice(1).map((value, i) => {
              const cell = row.getCell(i + 1)
              return cell.isMerged && cell.master.address !== cell.address ? '' : plainCell(value)
            })
          : [],
      )
    })
    return { name: sheet.name, rows }
  })
}

const COLUMN = {
  dish: /^(?:menu\s+item(?:\s+name)?|item(?:\s+name)?|name|dish|product)$/,
  product:
    /^(?:item|item\s+(?:description|name)|description(?:\s+of\s+goods)?|ingredient|product(?:\s+(?:name|description))?)$/,
  quantity:
    /^(?:qty|quantity)\.?(?:\s+(?:ship(?:ped)?|delivered|received|invoiced|sold|ordered))?$|^(?:shipped|delivered|received|sold|items\s+sold)(?:\s+qty)?$/,
  unit: /^(?:unit|uom|u\/m|unit\s+of\s+measure)$/,
  price: /^(?:unit\s+)?(?:price|cost|rate)(?:\s+(?:each|per\s+unit))?$|^(?:each|price\s+each)$/,
  total:
    /^(?:total(?:\s+price)?|line\s+(?:total|amount)|ext(?:ended|\.)?(?:\s+(?:price|amount|total|cost))?|amount)$/,
  described: /^(?:(?:item|product)\s+(?:description|name)|description(?:\s+of\s+goods)?)$/,
  takings: /^(?:(?:net|gross)\s+)?(?:sales|amount|revenue)$|^total(?:\s+sales)?$/,
  sku: /^(?:sku|item\s*(?:#|no\.?|code|number)|product\s+code|code)$/,
}

function columnOf(cols: Map<string, number>, pattern: RegExp): number | undefined {
  return [...cols].find(([key]) => pattern.test(key.replace(/\s+/g, ' ')))?.[1]
}

const DATE_COLUMNS = ['date', 'sale date', 'sales date', 'business date', 'day']

function dayIn(cell: unknown): string {
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return ''
    const local = cell.getHours() === 0 && cell.getMinutes() === 0
    const pad = (n: number) => String(n).padStart(2, '0')
    return local
      ? `${cell.getFullYear()}-${pad(cell.getMonth() + 1)}-${pad(cell.getDate())}`
      : cell.toISOString().slice(0, 10)
  }
  return String(cell ?? '').trim()
}

const salesHeaderAt = (rows: unknown[][]) =>
  rows.findIndex((row) => {
    const cols = header(row)
    return (
      columnOf(cols, COLUMN.dish) !== undefined && columnOf(cols, COLUMN.quantity) !== undefined
    )
  })

function preambleDay(rows: unknown[][]): string | undefined {
  const labelled = labelledPreamble(rows).date
  if (labelled && numericDay(labelled)) return numericDay(labelled)
  for (const cell of rows.flat()) {
    const day = numericDay(dayIn(cell))
    if (day) return day
  }
  return undefined
}

export async function parseSalesTables(input: ExtractInput, guess = true): Promise<SalesPayload[]> {
  const sheets = (await readSheets(input)).filter((s) => s.rows.length > 0)
  const labelled = sheets.filter((s) => salesHeaderAt(s.rows) !== -1)
  if (labelled.length === 0 && !guess) return []
  const byDay = new Map<string, SalesLine[]>()
  for (const sheet of labelled.length > 0 ? labelled : sheets.slice(0, 1)) {
    const headerAt = labelled.length > 0 ? salesHeaderAt(sheet.rows) : 0
    salesOfSheet(sheet.rows.slice(headerAt), preambleDay(sheet.rows.slice(0, headerAt)), byDay)
  }
  if (byDay.size === 0) return [{ kind: 'sales', items: [] }]
  return [...byDay].map(([date, items]) =>
    date ? { kind: 'sales', date, items } : { kind: 'sales', items },
  )
}

function salesOfSheet(
  rows: unknown[][],
  titled: string | undefined,
  byDay: Map<string, SalesLine[]>,
) {
  if (rows.length === 0) return
  const cols = header(rows[0])
  const nameCol = columnOf(cols, COLUMN.dish) ?? 0
  const qtyCol = columnOf(cols, COLUMN.quantity) ?? 1
  const takingsCol = columnOf(cols, COLUMN.takings)
  const priceCol = columnOf(cols, COLUMN.price) ?? (takingsCol === undefined ? 2 : undefined)
  const dateCol = DATE_COLUMNS.map((c) => cols.get(c)).find((i) => i !== undefined)

  const order =
    dateCol === undefined
      ? 'mdy'
      : (rows
          .slice(1)
          .map((row) => dayOrderOf(dayIn(row[dateCol])))
          .find((o) => o !== null) ?? 'mdy')
  for (const row of rows.slice(1)) {
    const name = String(row[nameCol] ?? '').trim()
    if (!name || isSummaryRow(name) || sameText(name, rows[0][nameCol])) continue
    const quantity = Math.round(num(row[qtyCol]))
    const unitPrice =
      priceCol !== undefined
        ? num(row[priceCol])
        : quantity === 0
          ? 0
          : Number((num(row[takingsCol!]) / quantity).toPrecision(12))
    if (blank(row[qtyCol]) && blank(row[priceCol ?? takingsCol!])) continue
    const written = dateCol === undefined ? '' : dayIn(row[dateCol])
    const day = numericDay(written, order) ?? (written || titled || '')
    const lines = byDay.get(day) ?? []
    lines.push({ menuItemName: name, quantity, unitPrice })
    byDay.set(day, lines)
  }
}

const invoiceNumberIn = (cell: string): string | undefined => {
  const match =
    /(?:\binvoice\b\s*(?:no\.?|num(?:ber)?|#)?\s*[:#]?\s*|#\s*)([a-z0-9][\w/.-]*)/i.exec(cell)
  return match && /\d/.test(match[1]) ? match[1] : undefined
}

function invoiceHeaderAt(rows: unknown[][]): number {
  return rows.findIndex((row) => {
    const cols = header(row)
    return (
      columnOf(cols, COLUMN.product) !== undefined &&
      columnOf(cols, COLUMN.quantity) !== undefined &&
      (columnOf(cols, COLUMN.price) !== undefined || columnOf(cols, COLUMN.total) !== undefined)
    )
  })
}

export async function parseInvoiceTables(input: ExtractInput): Promise<InvoicePayload[]> {
  const read = (await readSheets(input))
    .filter((s) => invoiceHeaderAt(s.rows) !== -1)
    .map((s) => invoiceOfSheet(s.rows))
    .filter((payload) => payload.items.length > 0)
  return read.length > 0 ? read : [{ kind: 'invoice', items: [] }]
}

export async function parseInvoiceTable(input: ExtractInput): Promise<InvoicePayload> {
  return (await parseInvoiceTables(input))[0]
}

function invoiceOfSheet(rows: unknown[][]): InvoicePayload {
  const headerAt = invoiceHeaderAt(rows)

  const cols = header(rows[headerAt])
  const nameCol = columnOf(cols, COLUMN.described) ?? columnOf(cols, COLUMN.product) ?? 0
  const qtyCol = columnOf(cols, COLUMN.quantity) ?? 1
  const unitCol = columnOf(cols, COLUMN.unit)
  const priceCol = columnOf(cols, COLUMN.price) ?? -1
  const totalCol = columnOf(cols, COLUMN.total)
  const skuCol = columnOf(cols, COLUMN.sku)

  const items: InvoiceLine[] = []
  for (const row of rows.slice(headerAt + 1)) {
    const rawName = String(row[nameCol] ?? '').trim()
    if (!rawName || isSummaryRow(rawName) || sameText(rawName, rows[headerAt][nameCol])) continue
    if (
      blank(row[qtyCol]) &&
      blank(row[priceCol]) &&
      (totalCol === undefined || blank(row[totalCol]))
    )
      continue
    const lineTotal = totalCol === undefined ? undefined : stated(row[totalCol])
    const sku = skuCol === undefined ? '' : String(row[skuCol] ?? '').trim()
    const priceUnit = unitAfter(row[priceCol], true)
    const unit =
      (unitCol === undefined ? '' : String(row[unitCol] ?? '').trim()) ||
      unitAfter(row[qtyCol], false) ||
      priceUnit
    items.push({
      rawName,
      ...(sku ? { sku } : {}),
      quantity: num(row[qtyCol]),
      unit,
      unitPrice: pricedPer(num(row[priceCol]), priceUnit, unit),
      ...(lineTotal === undefined ? {} : { lineTotal }),
    })
  }

  const labelled = labelledPreamble(rows.slice(0, headerAt))
  const preamble = rows
    .slice(0, headerAt)
    .flat()
    .map((c) => dayIn(c))
  const vendorName =
    labelled.vendor ??
    preamble.find((c) => c && !/invoice|date|#/i.test(c) && !PREAMBLE_LABEL.test(c))
  const number = labelled.number ?? preamble.map(invoiceNumberIn).find((n): n is string => !!n)
  const invoiceDate = labelled.date

  return {
    kind: 'invoice',
    ...(vendorName ? { vendorName } : {}),
    ...(number ? { number } : {}),
    ...(invoiceDate ? { invoiceDate } : {}),
    items,
  }
}

const PREAMBLE_LABEL =
  /^(vendor|supplier|seller|sold by|from|invoice|invoice\s*(no\.?|number|#)|inv\.?\s*(no\.?|#)?|number|no\.?|(invoice\s*)?date|dated|issued)\s*[:#]?$/i

function labelledPreamble(rows: unknown[][]) {
  const out: { vendor?: string; number?: string; date?: string } = {}
  const kindOf = (label: string): 'vendor' | 'number' | 'date' | null => {
    const key = label
      .trim()
      .toLowerCase()
      .replace(/[:#]\s*$/, '')
      .trim()
    if (/^(vendor|supplier|seller|sold by|from)$/.test(key)) return 'vendor'
    if (/^((invoice\s*)?date|dated|issued)$/.test(key)) return 'date'
    if (/^(invoice(\s*(no\.?|number|#))?|inv\.?(\s*(no\.?|#))?|number|no\.?)$/.test(key))
      return 'number'
    return null
  }
  const take = (kind: 'vendor' | 'number' | 'date', value: string) => {
    const text = value.trim()
    if (!text || out[kind]) return
    out[kind] = kind === 'date' ? (numericDay(text) ?? text) : text
  }
  for (const row of rows) {
    const cells = row.map((c) => dayIn(c))
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]
      if (!cell) continue
      const colon = cell.indexOf(':')
      if (colon > 0) {
        const kind = kindOf(cell.slice(0, colon))
        const value = cell.slice(colon + 1)
        if (kind && value.trim()) {
          take(kind, value)
          continue
        }
      }
      const kind = kindOf(cell)
      if (!kind) continue
      const next = cells.slice(i + 1).find((c) => c)
      if (next !== undefined && kindOf(next) === null) take(kind, next)
    }
  }
  return out
}

/* ===== Reading a file into text the model can be given ===== */

export async function docxToText(input: ExtractInput): Promise<string> {
  let xml: string | undefined
  try {
    const zip = await JSZip.loadAsync(input.buffer)
    xml = await zip.file('word/document.xml')?.async('string')
  } catch (e) {
    throw unreadable(input, (e as Error).message)
  }
  if (!xml) throw unreadable(input, 'no word/document.xml inside')
  let body = xml
  for (let inner = INNERMOST_TABLE; inner.test(body);)
    body = body.replace(inner, (table) => `<w:p >${tableRows(table)}</w:p>`)
  return body
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => xmlEntity(entity))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const INNERMOST_TABLE = /<w:tbl\b[^>]*>(?:(?!<w:tbl\b)[\s\S])*?<\/w:tbl>/g

const linesOf = (cell: string) =>
  [...cell.matchAll(/<w:p\b(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/w:p>)/g)].map(([, inner = '']) =>
    inner
      .replace(/<w:tab\b[^>]*\/>/g, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )

function tableRows(table: string): string {
  const out: string[] = []
  for (const [row] of table.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
    const cells = [...row.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map(([cell]) => linesOf(cell))
    const depth = Math.max(0, ...cells.map((lines) => lines.length))
    for (let i = 0; i < depth; i++) {
      const line = cells
        .map((lines) => lines[i] ?? '')
        .join(' | ')
        .replace(/(\s\|\s*)+$/, '')
        .trim()
      if (line) out.push(line)
    }
  }
  return out.join('\n')
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function xmlEntity(entity: string): string {
  const lower = entity.toLowerCase()
  if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16))
  if (lower.startsWith('#')) return String.fromCodePoint(Number(lower.slice(1)))
  return NAMED_ENTITIES[lower]
}

function readableUtf16(low: number, high: number): boolean {
  if (high === 0)
    return low === 0x09 || (low >= 0x20 && low !== 0x7f && (low < 0x80 || low >= 0xa0))
  return high === 0x20 || high === 0x21
}

export function utf16Text(buffer: Buffer): string {
  const runs: string[] = []
  let i = 0
  while (i + 1 < buffer.length) {
    let run = ''
    let j = i
    while (j + 1 < buffer.length && readableUtf16(buffer[j], buffer[j + 1])) {
      run += String.fromCharCode(buffer[j] | (buffer[j + 1] << 8))
      j += 2
    }
    if (/[A-Za-z].*[A-Za-z]/.test(run)) {
      runs.push(run.trim())
      i = j
    } else {
      i += 1
    }
  }
  return runs.join('\n')
}

const isWord97 = (input: ExtractInput): boolean =>
  /\.doc$/i.test(input.fileName) || input.mimeType === 'application/msword'

export async function docToText(input: ExtractInput): Promise<string> {
  let body: string
  try {
    body = (await new WordExtractor().extract(input.buffer)).getBody()
  } catch (e) {
    throw unreadable(input, (e as Error).message)
  }
  if (body.replace(/\s/g, '').length >= 20) return body.trim()
  return utf16Text(input.buffer)
}

function rowsToText(rows: unknown[][]): string {
  return rows.map((row) => row.map((cell) => String(cell ?? '').trim()).join('\t')).join('\n')
}

function sheetText(sheet: Sheet): string {
  return `Sheet: ${sheet.name}\n${rowsToText(sheet.rows)}`
}

export async function textFor(input: ExtractInput): Promise<string> {
  if (/\.docx$/i.test(input.fileName) || input.mimeType.includes('wordprocessingml')) {
    return docxToText(input)
  }
  if (isWord97(input)) return docToText(input)
  if (looksTabular(input)) {
    const sheets = (await readSheets(input)).filter((s) => s.rows.length > 0)
    return sheets.length === 1 ? rowsToText(sheets[0].rows) : sheets.map(sheetText).join('\n\n')
  }
  return input.buffer.toString('utf8')
}

const PART_CHARS = 20000
const MAX_PARTS = 16

const sheetLines = (sheet: Sheet): string[] => rowsToText(sheet.rows).split('\n')

function sheetParts(sheet: Sheet, budget: number): string[] {
  const whole = sheetText(sheet)
  if (whole.length <= budget) return [whole]
  const title = `Sheet: ${sheet.name}`
  const parts: string[] = []
  let current = title
  for (const row of sheetLines(sheet)) {
    const line = row.slice(0, budget - title.length - 1)
    if (current.length + 1 + line.length > budget) {
      parts.push(current)
      current = title
    }
    current += `\n${line}`
  }
  if (current !== title) parts.push(current)
  return parts
}

export async function textChunks(
  input: ExtractInput,
  budget = PART_CHARS,
  maxParts = MAX_PARTS,
): Promise<string[]> {
  if (!looksTabular(input)) return [await textFor(input)]
  const pieces = (await readSheets(input))
    .filter((s) => s.rows.some((row) => row.some((cell) => String(cell ?? '').trim())))
    .flatMap((s) => sheetParts(s, budget))
  const parts: string[] = []
  for (const piece of pieces) {
    const last = parts[parts.length - 1]
    if (last !== undefined && last.length + 2 + piece.length <= budget) {
      parts[parts.length - 1] = `${last}\n\n${piece}`
    } else {
      parts.push(piece)
    }
  }
  if (parts.length > maxParts) {
    throw unreadable(
      input,
      'it is too large to read in one upload; split it into smaller workbooks',
    )
  }
  return parts
}

/* ===== Stub extractor ===== */

@Injectable()
export class StubExtractor implements DocumentExtractor {
  async extract(input: ExtractInput): Promise<ExtractionResult[]> {
    if (looksTabular(input)) {
      if (input.type === 'sales') {
        return (await parseSalesTables(input)).map((payload) => ({ payload, confidence: null }))
      }
      if (input.type === 'invoice') {
        return (await parseInvoiceTables(input)).map((payload) => ({ payload, confidence: null }))
      }
    }

    const fromJson = this.tryJson(input)
    if (fromJson) return fromJson

    if (!MODEL_READS.test(input.mimeType)) {
      throw unreadable(input, 'no extraction model is configured for this format')
    }
    return [{ payload: canned(input.type), confidence: 0.5 }]
  }

  private tryJson(input: ExtractInput): ExtractionResult[] | null {
    if (!input.mimeType.includes('json') && !/\.json$/i.test(input.fileName)) return null
    try {
      const parsed = JSON.parse(input.buffer.toString('utf8')) as unknown
      const list = Array.isArray(parsed) ? parsed : [parsed]
      const results = list
        .filter((p): p is ExtractionPayload => !!p && (p as ExtractionPayload).kind === input.type)
        .map((payload) => ({ payload, confidence: null }))
      return results.length ? results : null
    } catch {
      return null
    }
  }
}

/* ===== Model extractors ===== */

const MODEL_TIMEOUT_MS = 180_000
const WORTH_ANOTHER_TRY = new Set([408, 409, 425, 429])

function refusedBy(source: string, status: number, detail: string): Error {
  const message = `${source} ${status}: ${detail.slice(0, 300)}`
  return status >= 500 || WORTH_ANOTHER_TRY.has(status)
    ? new Error(message)
    : new ExtractionRefused(message)
}

function answerOf(source: string, text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new ExtractionRefused(
      `${source} answered with values that could not be read: ${(e as Error).message}`,
    )
  }
}

export interface ModelConfig {
  apiKey: string
  model: string
  effort?: 'low' | 'medium' | 'high'
  fetch?: typeof fetch
}

const RECIPE_FIELDS = {
  name: { type: 'STRING' },
  portions: { type: 'NUMBER' },
  yieldQty: { type: 'NUMBER' },
  yieldUnit: { type: 'STRING' },
  items: {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        rawName: { type: 'STRING' },
        quantity: { type: 'NUMBER', nullable: true },
        unit: { type: 'STRING' },
        quantityText: { type: 'STRING' },
        note: { type: 'STRING' },
      },
      required: ['rawName'],
    },
  },
}

const RESPONSE_SCHEMAS: Record<DocumentType, object> = {
  invoice: {
    type: 'OBJECT',
    properties: {
      vendorName: { type: 'STRING' },
      number: { type: 'STRING' },
      invoiceDate: { type: 'STRING' },
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            rawName: { type: 'STRING' },
            sku: { type: 'STRING' },
            quantity: { type: 'NUMBER' },
            unit: { type: 'STRING' },
            unitPrice: { type: 'NUMBER' },
            lineTotal: { type: 'NUMBER' },
          },
          required: ['rawName', 'quantity', 'unit', 'unitPrice'],
        },
      },
    },
    required: ['items'],
  },
  sales: {
    type: 'OBJECT',
    properties: {
      date: { type: 'STRING' },
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            menuItemName: { type: 'STRING' },
            quantity: { type: 'NUMBER' },
            unitPrice: { type: 'NUMBER' },
          },
          required: ['menuItemName', 'quantity', 'unitPrice'],
        },
      },
    },
    required: ['items'],
  },
  recipe: {
    type: 'OBJECT',
    properties: {
      ...RECIPE_FIELDS,
      subRecipes: {
        type: 'ARRAY',
        items: { type: 'OBJECT', properties: RECIPE_FIELDS, required: ['name', 'items'] },
      },
    },
    required: ['name', 'items'],
  },
  menu: {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING' },
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            price: { type: 'NUMBER' },
            section: { type: 'STRING' },
          },
          required: ['name', 'price'],
        },
      },
    },
    required: ['items'],
  },
}

const PROMPTS: Record<DocumentType, string> = {
  invoice:
    "Extract this vendor invoice as JSON. Keep each line item's raw ingredient name exactly as written. Quantities, units and unit prices are numbers; unit is the purchase unit (kg, l, case, each). Give sku only when the line prints an item code of its own, and lineTotal only when the line states its own total; copy both as written rather than recomputing or inventing them. Subtotal, tax and total rows are not line items and produce no line. Give invoiceDate as YYYY-MM-DD.",
  sales:
    'Extract this sales report as JSON: the date of the sales it reports as YYYY-MM-DD, and one line per menu item sold, with the item name exactly as written, the quantity sold and the unit selling price as numbers. Lines that are not a menu item (category or department totals, taxes, discounts, tips, payments, deposits) produce no line.',
  recipe:
    'Extract this recipe as JSON: its name, how many portions it makes, the yield quantity and unit if stated, and one entry per ingredient with the ingredient name exactly as written, the quantity as a number and the measurement unit. When the quantity is a range or a choice (2 or 4, 2-3, 1 to 2), give its first figure as the quantity and copy the quantity exactly as written into quantityText; otherwise leave quantityText out. A line the paper gives no amount keeps its name, with no quantity and the phrase as written (to taste, to fry, for garnish) in note, or no note when there is none; never drop such a line and never write 0 for it. A component the file writes out with an ingredient list of its own (a sauce, dressing, dough or garnish) belongs to the recipe that uses it: return it under the subRecipes of that recipe, never as a separate entry in "documents", and keep a line for it among the items of that recipe, named as the component is named, with the quantity the recipe uses.',
  menu: 'Extract this menu as JSON: the name the menu prints for itself, if any, and one entry per dish with the dish name exactly as written, its selling price as a number, and the menu section it is listed under if the menu has sections.',
}

const MODEL_READS = /^(image\/|application\/pdf)/

async function textParts(input: ExtractInput): Promise<string[] | null> {
  return MODEL_READS.test(input.mimeType) ? null : textChunks(input)
}

function tabular(input: ExtractInput): Promise<ExtractionResult[]> | null {
  if (!looksTabular(input)) return null
  if (input.type === 'sales') {
    return parseSalesTables(input, false).then((payloads) =>
      payloads.filter((p) => p.items.length > 0).map((payload) => ({ payload, confidence: null })),
    )
  }
  if (input.type === 'invoice') {
    return parseInvoiceTables(input).then((payloads) =>
      payloads.filter((p) => p.items.length > 0).map((payload) => ({ payload, confidence: null })),
    )
  }
  return null
}

const WHAT: Record<DocumentType, string> = {
  invoice: 'invoice',
  sales: 'sales report',
  recipe: 'recipe',
  menu: 'menu',
}

function instruction(type: DocumentType, workbook: boolean): string {
  const base = `${PROMPTS[type]} A single file may hold more than one; return each as a separate entry in "documents".`
  if (!workbook) return base
  return `${base} The text comes from a workbook, one sheet after another under "Sheet:" headings. Sheets that hold no ${WHAT[type]} (a table of contents, stock counts, order guides, schedules) produce no entry.`
}

function documentsSchema(type: DocumentType): object {
  return {
    type: 'OBJECT',
    properties: { documents: { type: 'ARRAY', items: RESPONSE_SCHEMAS[type] } },
    required: ['documents'],
  }
}

function asResults(type: DocumentType, parsed: unknown, source: string): ExtractionResult[] {
  const documents = (parsed as { documents?: unknown } | null)?.documents
  if (!Array.isArray(documents)) throw new ExtractionRefused(`${source} returned no documents`)
  return documents.map((d) => ({
    payload: { ...(d as Record<string, unknown>), kind: type } as ExtractionPayload,
    confidence: null,
  }))
}

export function jsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(jsonSchema)
  if (!schema || typeof schema !== 'object') return schema
  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [
      key,
      key === 'type' && typeof value === 'string' ? value.toLowerCase() : jsonSchema(value),
    ]),
  )
}

@Injectable()
export class GeminiExtractor implements DocumentExtractor {
  constructor(private readonly cfg: ModelConfig) {}

  async extract(input: ExtractInput): Promise<ExtractionResult[]> {
    const table = await tabular(input)
    if (table?.length) return table

    const texts = await textParts(input)
    if (!texts) {
      const data = input.buffer.toString('base64')
      return this.ask(input.type, { inline_data: { mime_type: input.mimeType, data } }, false)
    }
    const results: ExtractionResult[] = []
    for (const text of texts) {
      results.push(...(await this.ask(input.type, { text }, looksTabular(input))))
    }
    return results
  }

  private async ask(
    type: DocumentType,
    file: object,
    workbook: boolean,
  ): Promise<ExtractionResult[]> {
    const body = {
      contents: [{ role: 'user', parts: [{ text: instruction(type, workbook) }, file] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: documentsSchema(type),
        temperature: 0,
        maxOutputTokens: 16384,
      },
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.cfg.model}:generateContent?key=${this.cfg.apiKey}`
    const res = await (this.cfg.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    })
    if (!res.ok) throw refusedBy('Gemini', res.status, await res.text().catch(() => ''))
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('Gemini returned no content')
    return asResults(type, answerOf('Gemini', text), 'Gemini')
  }
}

export interface PairConfig {
  apiKey: string
  draftModel: string
  reviewModel: string
  fetch?: typeof fetch
  warn?: (message: string) => void
}

type Corrections = {
  add?: unknown[]
  remove?: unknown[]
  replace?: { id?: unknown; document?: unknown }[]
}

function correctionsSchema(type: DocumentType): object {
  const document = RESPONSE_SCHEMAS[type]
  return {
    type: 'OBJECT',
    properties: {
      add: { type: 'ARRAY', items: document },
      remove: { type: 'ARRAY', items: { type: 'INTEGER' } },
      replace: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { id: { type: 'INTEGER' }, document },
          required: ['id', 'document'],
        },
      },
    },
    required: ['add', 'remove', 'replace'],
  }
}

function reviewInstruction(type: DocumentType, workbook: boolean, draft: unknown[]): string {
  const numbered = draft.map((d, id) => ({ id, ...(d as Record<string, unknown>) }))
  return [
    `You review a draft reading of a restaurant document. This is how the document is to be read: ${instruction(type, workbook)}`,
    `The DOCUMENT is the source of truth. Find what the DRAFT got wrong: ${WHAT[type]} entries it missed entirely, entries that are not ${WHAT[type]} (a stray letter, a heading or a station name is not one), and lines that are missing, extra, or carry a wrong name, quantity, unit or price. Copy values as the paper writes them; do not invent.`,
    'Answer with corrections only: "add" holds whole entries the draft missed, each with every line the paper lists for it; "remove" the ids of draft entries that should not be there; "replace" an id with the whole corrected entry. Do not replace an entry only to restate a number with more or fewer digits. A line that names a sub-recipe keeps the sub-recipe\'s name exactly, so the two stay joined. Leave all three empty when the draft is right.',
    `DRAFT: ${JSON.stringify(numbered)}`,
  ].join('\n\n')
}

type Lined = { items?: { rawName?: unknown }[]; subRecipes?: { name?: unknown }[] }

function componentNamesKept(before: unknown, after: unknown): unknown {
  const was = before as Lined
  const now = after as Lined
  if (!Array.isArray(was?.items) || !Array.isArray(now?.items)) return after
  const subs = new Set(
    [...(was.subRecipes ?? []), ...(now.subRecipes ?? [])]
      .map((sub) => (typeof sub?.name === 'string' ? sub.name.trim().toLowerCase() : ''))
      .filter(Boolean),
  )
  const named = (line: { rawName?: unknown } | undefined) =>
    typeof line?.rawName === 'string' && subs.has(line.rawName.trim().toLowerCase())
  const items = now.items.map((line, i) => {
    const old = was.items?.[i]
    return named(old) && !named(line) ? { ...line, rawName: old!.rawName } : line
  })
  return { ...(after as object), items }
}

function merged(draft: unknown[], corrections: Corrections): unknown[] {
  const kept = new Map(draft.map((d, id) => [id, d]))
  for (const r of corrections.replace ?? [])
    if (typeof r.id === 'number' && kept.has(r.id) && r.document)
      kept.set(r.id, componentNamesKept(kept.get(r.id), r.document))
  for (const id of corrections.remove ?? []) if (typeof id === 'number') kept.delete(id)
  return [...kept.values(), ...(corrections.add ?? [])]
}

type GeminiAnswer = {
  candidates?: {
    finishReason?: string
    content?: { parts?: { text?: string; thought?: boolean }[] }
  }[]
}

async function askGemini(
  cfg: { apiKey: string; model: string; fetch?: typeof fetch },
  parts: object[],
  schema: object,
): Promise<{ answer: unknown; finished: boolean }> {
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      thinkingConfig: { thinkingLevel: 'low' },
      maxOutputTokens: 32768,
    },
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`
  const res = await (cfg.fetch ?? fetch)(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  })
  if (!res.ok) throw refusedBy('Gemini', res.status, await res.text().catch(() => ''))
  const data = (await res.json()) as GeminiAnswer
  const candidate = data.candidates?.[0]
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join('')
  if (!text) throw new Error('Gemini returned no content')
  return { answer: answerOf('Gemini', text), finished: candidate?.finishReason === 'STOP' }
}

@Injectable()
export class PairExtractor implements DocumentExtractor {
  private readonly logger = new Logger(PairExtractor.name)

  constructor(private readonly cfg: PairConfig) {}

  async extract(input: ExtractInput): Promise<ExtractionResult[]> {
    const table = await tabular(input)
    if (table?.length) return table

    const texts = await textParts(input)
    if (!texts) {
      const data = input.buffer.toString('base64')
      return this.read(input.type, { inline_data: { mime_type: input.mimeType, data } }, false)
    }
    const results: ExtractionResult[] = []
    for (const text of texts) {
      results.push(...(await this.read(input.type, { text }, looksTabular(input))))
    }
    return results
  }

  private async read(
    type: DocumentType,
    file: object,
    workbook: boolean,
  ): Promise<ExtractionResult[]> {
    const model = (name: string) => ({
      apiKey: this.cfg.apiKey,
      model: name,
      fetch: this.cfg.fetch,
    })
    const first = await askGemini(
      model(this.cfg.draftModel),
      [{ text: instruction(type, workbook) }, file],
      documentsSchema(type),
    )
    const draft = (first.answer as { documents?: unknown } | null)?.documents
    if (!Array.isArray(draft)) throw new ExtractionRefused('Gemini returned no documents')
    let documents = draft
    try {
      const ask = () =>
        askGemini(
          model(this.cfg.reviewModel),
          [{ text: reviewInstruction(type, workbook, draft) }, file],
          correctionsSchema(type),
        )
      const check = await ask().catch((e: unknown) => {
        if (e instanceof ExtractionRefused) throw e
        return ask()
      })
      if (!check.finished) throw new Error('the answer was cut short')
      documents = merged(draft, check.answer as Corrections)
    } catch (e) {
      const message = `The check by ${this.cfg.reviewModel} failed, the draft is kept: ${(e as Error).message}`
      if (this.cfg.warn) this.cfg.warn(message)
      else this.logger.warn(message)
    }
    return asResults(type, { documents }, 'Gemini')
  }
}

function strictSchema(schema: unknown): unknown {
  const read = jsonSchema(schema)
  const closed = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(closed)
    if (!node || typeof node !== 'object') return node
    const { nullable, ...rest } = node as Record<string, unknown>
    const out = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, closed(v)]))
    if (nullable === true) out.type = [out.type, 'null']
    return out.type === 'object' ? { ...out, additionalProperties: false } : out
  }
  return closed(read)
}

function claudeFile(input: ExtractInput): object {
  const data = input.buffer.toString('base64')
  if (input.mimeType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: input.mimeType, data } }
  }
  return { type: 'image', source: { type: 'base64', media_type: input.mimeType, data } }
}

@Injectable()
export class ClaudeExtractor implements DocumentExtractor {
  constructor(private readonly cfg: ModelConfig) {}

  async extract(input: ExtractInput): Promise<ExtractionResult[]> {
    const table = await tabular(input)
    if (table?.length) return table

    const texts = await textParts(input)
    if (!texts) return this.ask(input.type, claudeFile(input), false)
    const results: ExtractionResult[] = []
    for (const text of texts) {
      results.push(...(await this.ask(input.type, { type: 'text', text }, looksTabular(input))))
    }
    return results
  }

  private async ask(
    type: DocumentType,
    file: object,
    workbook: boolean,
  ): Promise<ExtractionResult[]> {
    const body = {
      model: this.cfg.model,
      max_tokens: 16000,
      output_config: {
        effort: this.cfg.effort ?? 'low',
        format: { type: 'json_schema', schema: strictSchema(documentsSchema(type)) },
      },
      messages: [
        {
          role: 'user',
          content: [file, { type: 'text', text: instruction(type, workbook) }],
        },
      ],
    }

    const res = await (this.cfg.fetch ?? fetch)('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    })
    if (!res.ok) throw refusedBy('Claude', res.status, await res.text().catch(() => ''))
    const data = (await res.json()) as {
      stop_reason?: string
      content?: { type?: string; text?: string }[]
    }
    if (data.stop_reason === 'refusal')
      throw new ExtractionRefused('Claude declined to read this file')
    const text = data.content?.find((c) => c.type === 'text' && c.text)?.text
    if (!text) throw new Error('Claude returned no content')
    return asResults(type, answerOf('Claude', text), 'Claude')
  }
}

function canned(type: ExtractInput['type']): ExtractionPayload {
  switch (type) {
    case 'invoice':
      return {
        kind: 'invoice',
        vendorName: 'Sample Vendor',
        number: 'SAMPLE-001',
        items: [
          { rawName: 'Sample Ingredient', quantity: 10, unit: 'kg', unitPrice: 4.5, lineTotal: 45 },
        ],
      }
    case 'sales':
      return {
        kind: 'sales',
        items: [{ menuItemName: 'Sample Item', quantity: 1, unitPrice: 9.5 }],
      }
    case 'recipe':
      return {
        kind: 'recipe',
        name: 'Sample Recipe',
        portions: 4,
        yieldQty: 1,
        yieldUnit: 'portion',
        items: [{ rawName: 'Sample Ingredient', quantity: 0.5, unit: 'kg' }],
      }
    case 'menu':
      return {
        kind: 'menu',
        name: 'Sample Menu',
        items: [
          { name: 'Sample Menu Item', price: 12, section: 'Mains' },
          { name: 'Sample Dessert', price: 7, section: 'Desserts' },
        ],
      }
  }
}
