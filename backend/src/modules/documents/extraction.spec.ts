import JSZip from 'jszip'
import { Workbook } from 'exceljs'
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ClaudeExtractor,
  ExtractionRefused,
  GeminiExtractor,
  PairExtractor,
  StubExtractor,
  docxToText,
  parseInvoiceTable,
  parseSalesTables,
  prepareInput,
  textChunks,
  textFor,
  utf16Text,
  type ExtractInput,
} from './extraction'

const workbook = async (sheets: Record<string, unknown[][]>): Promise<Buffer> => {
  const wb = new Workbook()
  for (const [name, rows] of Object.entries(sheets)) wb.addWorksheet(name).addRows(rows)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

const docx = async (paragraphs: string[]): Promise<Buffer> => {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`,
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const input = (over: Partial<ExtractInput>): ExtractInput => ({
  type: 'invoice',
  fileName: 'file.bin',
  mimeType: 'application/octet-stream',
  buffer: Buffer.from(''),
  ...over,
})

describe('parseSalesTables', () => {
  it('reads a CSV with a header row, mapping columns by name', async () => {
    const csv = 'Menu Item,Quantity,Unit Price\nBurger,3,9.50\nFries,5,4\n'
    const [payload] = await parseSalesTables(
      input({
        type: 'sales',
        fileName: 'sales.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload).toEqual({
      kind: 'sales',
      items: [
        { menuItemName: 'Burger', quantity: 3, unitPrice: 9.5 },
        { menuItemName: 'Fries', quantity: 5, unitPrice: 4 },
      ],
    })
  })

  it('reads the day of the sales from a date column, one report per day', async () => {
    const csv =
      'Date,Menu Item,Quantity,Unit Price\n2026-09-27,Burger,3,9.50\n2026-09-28,Fries,5,4\n2026-09-27,Soup,1,6\n'
    const payloads = await parseSalesTables(
      input({
        type: 'sales',
        fileName: 'sales.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payloads).toEqual([
      {
        kind: 'sales',
        date: '2026-09-27',
        items: [
          { menuItemName: 'Burger', quantity: 3, unitPrice: 9.5 },
          { menuItemName: 'Soup', quantity: 1, unitPrice: 6 },
        ],
      },
      {
        kind: 'sales',
        date: '2026-09-28',
        items: [{ menuItemName: 'Fries', quantity: 5, unitPrice: 4 }],
      },
    ])
  })

  it('reads a date a spreadsheet stores as a date', async () => {
    const buffer = await workbook({
      Sales: [
        ['Sale Date', 'Menu Item', 'Quantity', 'Unit Price'],
        [new Date(Date.UTC(2026, 8, 27)), 'Burger', 3, 9.5],
      ],
    })
    const [payload] = await parseSalesTables(
      input({ type: 'sales', fileName: 's.xlsx', mimeType: SHEET, buffer }),
    )
    expect(payload).toMatchObject({ date: '2026-09-27' })
  })

  it('reads a decimal comma as a decimal and a thousands comma as thousands', async () => {
    const csv =
      'Menu Item;Quantity;Unit Price\nBurger;3;"12,50"\nSteak;1;"1.234,5"\nWine;2;"1,250"\nSoup;1;7.25\n'
    const [payload] = await parseSalesTables(
      input({
        type: 'sales',
        fileName: 'sales.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv.replace(/;/g, ',')),
      }),
    )
    expect(payload.items.map((i) => i.unitPrice)).toEqual([12.5, 1234.5, 1250, 7.25])
  })

  it('reads a price written with its currency, a credit in brackets or with a trailing minus, and a unit after it', async () => {
    const cells = [
      '€12,50',
      '£12.50',
      'USD 12.50',
      '12.50 EUR',
      '(12.50)',
      '12.50-',
      '-12,50',
      '12.5 kg',
      '0,125',
      '1 234,50',
      'n/a',
    ]
    const csv =
      'Item,Quantity,Unit,Unit Price\n' +
      cells.map((c, i) => `Line ${i},1,kg,"${c}"`).join('\n') +
      '\n'
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload.items.map((i) => i.unitPrice)).toEqual([
      12.5, 12.5, 12.5, 12.5, -12.5, -12.5, -12.5, 12.5, 0.125, 1234.5, 0,
    ])
  })

  it('reads a quantity below one written with a decimal comma', async () => {
    const csv = 'Item,Quantity,Unit,Unit Price\nSaffron,"0,125",kg,2\nSalt,"0,5",kg,1\n'
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload.items.map((i) => i.quantity)).toEqual([0.125, 0.5])
  })

  it('reads a sales date written day first, and takes the order from the rest of the file', async () => {
    const rows = ['03/04/2026', '27/04/2026', '28.04.2026', '29-04-2026']
    const csv =
      'Date,Menu Item,Quantity,Unit Price\n' + rows.map((d) => `"${d}",Soup,1,6`).join('\n') + '\n'
    const days = await parseSalesTables(
      input({ type: 'sales', fileName: 's.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }),
    )
    expect(days.map((d) => d.date)).toEqual([
      '2026-04-03',
      '2026-04-27',
      '2026-04-28',
      '2026-04-29',
    ])
  })

  it('keeps a month-first file month first', async () => {
    const csv =
      'Date,Menu Item,Quantity,Unit Price\n"03/04/2026",Soup,1,6\n"04/27/2026",Soup,1,6\n"9/27/26",Soup,1,6\n'
    const days = await parseSalesTables(
      input({ type: 'sales', fileName: 's.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }),
    )
    expect(days.map((d) => d.date)).toEqual(['2026-03-04', '2026-04-27', '2026-09-27'])
  })

  it('reads no sale from a total, tax or tip row at the foot of the report', async () => {
    const csv =
      'Item,Qty,Price\nSoup,2,6\nSubtotal,2,12\nSales Tax 8%,,0.96\nTips,,3\nGRAND TOTAL:,,15.96\nTotal Cereal Bowl,1,4\n'
    const [payload] = await parseSalesTables(
      input({ type: 'sales', fileName: 's.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }),
    )
    expect(payload.items.map((i) => i.menuItemName)).toEqual(['Soup', 'Total Cereal Bowl'])
  })

  it('finds the header below a title and takes the day of the report from above it', async () => {
    const csv =
      'Golden Fork Downtown\nSales report,30/09/2026\nItem,Qty,Price\nSoup,2,6\nBurger,1,12\n'
    const [payload] = await parseSalesTables(
      input({ type: 'sales', fileName: 's.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }),
    )
    expect(payload).toEqual({
      kind: 'sales',
      date: '2026-09-30',
      items: [
        { menuItemName: 'Soup', quantity: 2, unitPrice: 6 },
        { menuItemName: 'Burger', quantity: 1, unitPrice: 12 },
      ],
    })
  })

  it('reads the price of one from the line amount when the report prints no unit price', async () => {
    const csv = 'Item,Qty Sold,Net Sales\nSoup,4,24.00\nBurger,3,37.50\nWater,2,0\n'
    const [payload] = await parseSalesTables(
      input({ type: 'sales', fileName: 's.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }),
    )
    expect(payload.items).toEqual([
      { menuItemName: 'Soup', quantity: 4, unitPrice: 6 },
      { menuItemName: 'Burger', quantity: 3, unitPrice: 12.5 },
      { menuItemName: 'Water', quantity: 2, unitPrice: 0 },
    ])
  })

  it('reads no sale from a category heading or a repeated header', async () => {
    const csv = 'Item,Qty,Price\nSTARTERS,,\nSoup,2,6\nItem,Qty,Price\n'
    const [payload] = await parseSalesTables(
      input({ type: 'sales', fileName: 's.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }),
    )
    expect(payload.items.map((i) => i.menuItemName)).toEqual(['Soup'])
  })

  it('skips rows without an item name', async () => {
    const csv = 'item,qty,price\nSoup,2,6\n,,\n'
    const [payload] = await parseSalesTables(
      input({ type: 'sales', fileName: 's.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }),
    )
    expect(payload.items).toHaveLength(1)
  })
})

describe('parseInvoiceTable', () => {
  it('reads a CSV invoice, mapping columns by name', async () => {
    const csv = 'Item,Quantity,Unit,Unit Price\nBeef Tenderloin,2,kg,55\nOlive Oil,3,l,12\n'
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload.items).toEqual([
      { rawName: 'Beef Tenderloin', quantity: 2, unit: 'kg', unitPrice: 55 },
      { rawName: 'Olive Oil', quantity: 3, unit: 'l', unitPrice: 12 },
    ])
  })

  it('reads the vendor own item code when the sheet prints one, and leaves it off when it does not', async () => {
    const csv =
      'Item,SKU,Quantity,Unit,Unit Price\nBeef Tenderloin,PM-441,2,kg,55\nOlive Oil,,3,l,12\n'
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload.items).toEqual([
      { rawName: 'Beef Tenderloin', sku: 'PM-441', quantity: 2, unit: 'kg', unitPrice: 55 },
      { rawName: 'Olive Oil', quantity: 3, unit: 'l', unitPrice: 12 },
    ])
  })

  it('takes the vendor and the number from the rows above the header', async () => {
    const csv = 'Sysco Foods,,,\nInvoice #A-77,,,\nDescription,Qty,Unit,Price\nFlour,5,kg,1.4\n'
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload.vendorName).toBe('Sysco Foods')
    expect(payload.number).toBe('A-77')
    expect(payload.items).toHaveLength(1)
  })

  it('reads a label and value preamble: vendor, number and date in separate cells', async () => {
    const csv =
      'Vendor,Dairy Direct\nInvoice,PROBE-1\nDate,2026-09-30\n\nItem,Qty,Unit,Unit price,Total\nUnsalted Butter,2,kg,9.50,19.00\n'
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload.vendorName).toBe('Dairy Direct')
    expect(payload.number).toBe('PROBE-1')
    expect(payload.invoiceDate).toBe('2026-09-30')
    expect(payload.items).toHaveLength(1)
  })

  it('reads a label and value written in one cell, and a day-first date', async () => {
    const csv =
      'Supplier: Prime Meats Co.,,,\nInvoice No: 5531,,,\nInvoice date: 30.09.2026,,,\nDescription,Qty,Unit,Price\nFlour,5,kg,1.4\n'
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload.vendorName).toBe('Prime Meats Co.')
    expect(payload.number).toBe('5531')
    expect(payload.invoiceDate).toBe('2026-09-30')
  })

  it.each([
    ['Invoice #A-77', 'A-77'],
    ['Invoice VIS-1042', 'VIS-1042'],
    ['Invoice No. 5531', '5531'],
    ['Invoice number: INV/2026-09', 'INV/2026-09'],
  ])('reads the number from "%s" and never takes it for the vendor', async (line, number) => {
    const csv = `Dairy Direct,,,\n${line},,,\nDescription,Qty,Unit,Price\nFlour,5,kg,1.4\n`
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload.number).toBe(number)
    expect(payload.vendorName).toBe('Dairy Direct')
  })

  it('copies the total a line states rather than recomputing it', async () => {
    const csv =
      'Item,Quantity,Unit,Unit Price,Total Price\nUnsalted Butter,8,kg,9.5,76\nHeavy Cream,12,l,3.2,36.9\n'
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload.items).toEqual([
      { rawName: 'Unsalted Butter', quantity: 8, unit: 'kg', unitPrice: 9.5, lineTotal: 76 },
      { rawName: 'Heavy Cream', quantity: 12, unit: 'l', unitPrice: 3.2, lineTotal: 36.9 },
    ])
  })

  it('leaves a line with no total of its own without one', async () => {
    const csv = 'Item,Quantity,Unit,Unit Price,Amount\nFlour,5,kg,1.4,7\nSugar,2,kg,2,\n'
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload.items[0].lineTotal).toBe(7)
    expect(payload.items[1]).not.toHaveProperty('lineTotal')
  })

  it('reads no line from the subtotal, tax and total rows at the foot of the invoice', async () => {
    const csv =
      'Item,Quantity,Unit,Unit Price,Total\nUnsalted Butter,5,kg,9.50,47.50\n,,,,\nSubtotal,,,,47.50\nTax (8%),,,,3.80\nVAT 20%:,,,,9.50\nBalance Due,,,,51.30\nTotal,,,,51.30\n'
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload.items).toEqual([
      { rawName: 'Unsalted Butter', quantity: 5, unit: 'kg', unitPrice: 9.5, lineTotal: 47.5 },
    ])
  })

  it('reads no line from a section heading or a header repeated on the next page', async () => {
    const csv =
      'Item,Quantity,Unit,Unit Price\nDAIRY,,,\nUnsalted Butter,5,kg,9.50\nItem,Quantity,Unit,Unit Price\nMEAT & POULTRY,,,\nBeef Tenderloin,2,kg,38.5\nFree sample,0,,0\n'
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload.items.map((i) => i.rawName)).toEqual([
      'Unsalted Butter',
      'Beef Tenderloin',
      'Free sample',
    ])
  })

  it('keeps the unit written beside the quantity when the sheet has no unit column, and a price per unit', async () => {
    const csv =
      'Item,Quantity,Unit Price,Total\nUnsalted Butter,500 g,9.50/kg,4.75\nHeavy Cream 33%,2 l,$3.60 per l,7.20\nCrates,2 case,10,20\nEggs,24,0.25,6\n'
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload.items).toEqual([
      { rawName: 'Unsalted Butter', quantity: 500, unit: 'g', unitPrice: 0.0095, lineTotal: 4.75 },
      { rawName: 'Heavy Cream 33%', quantity: 2, unit: 'l', unitPrice: 3.6, lineTotal: 7.2 },
      { rawName: 'Crates', quantity: 2, unit: 'case', unitPrice: 10, lineTotal: 20 },
      { rawName: 'Eggs', quantity: 24, unit: '', unitPrice: 0.25, lineTotal: 6 },
    ])
  })

  it('reads a sheet separated by semicolons or tabs, with a decimal comma', async () => {
    for (const csv of [
      'Item;Qty;Unit;Price\nUnsalted Butter;5;kg;9,50\n',
      'Item\tQty\tUnit\tPrice\nUnsalted Butter\t5\tkg\t9,50\n',
    ]) {
      const payload = await parseInvoiceTable(
        input({
          type: 'invoice',
          fileName: 'inv.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from(csv),
        }),
      )
      expect(payload.items).toEqual([
        { rawName: 'Unsalted Butter', quantity: 5, unit: 'kg', unitPrice: 9.5 },
      ])
    }
  })

  it('reads a CSV saved in the Windows code page or in UTF-16 with its accents intact', async () => {
    const text = 'Item,Qty,Unit,Price\nCrème fraîche,2,l,6.40\nJalapeño,1,kg,4\n'
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(text.replace(/,/g, '\t'), 'utf16le'),
    ])
    for (const buffer of [Buffer.from(text, 'latin1'), utf16]) {
      const payload = await parseInvoiceTable(
        input({ type: 'invoice', fileName: 'inv.csv', mimeType: 'text/csv', buffer }),
      )
      expect(payload.items.map((i) => i.rawName)).toEqual(['Crème fraîche', 'Jalapeño'])
    }
  })

  it('reads every invoice in a workbook that keeps one to a sheet', async () => {
    const buffer = await workbook({
      'INV-1': [
        ['Invoice No:', 'A-1'],
        ['Item', 'Qty', 'Unit', 'Price'],
        ['Butter', 5, 'kg', 9.5],
      ],
      Notes: [['delivered before noon']],
      'INV-2': [
        ['Invoice No:', 'A-2'],
        ['Item', 'Qty', 'Unit', 'Price'],
        ['Cream', 2, 'l', 3.6],
      ],
    })
    const results = await new StubExtractor().extract(
      input({ type: 'invoice', fileName: 'week.xlsx', mimeType: SHEET, buffer }),
    )
    expect(results.map((r) => (r.payload as { number?: string }).number)).toEqual(['A-1', 'A-2'])
  })

  it('reads the sales of every sheet in a workbook', async () => {
    const buffer = await workbook({
      Mon: [
        ['Date', 'Item', 'Qty', 'Price'],
        ['2026-09-28', 'Soup', 2, 6],
      ],
      Tue: [
        ['Date', 'Item', 'Qty', 'Price'],
        ['2026-09-29', 'Soup', 3, 6],
      ],
    })
    const payloads = await parseSalesTables(
      input({ type: 'sales', fileName: 'week.xlsx', mimeType: SHEET, buffer }),
    )
    expect(payloads.map((p) => [p.date, p.items.length])).toEqual([
      ['2026-09-28', 1],
      ['2026-09-29', 1],
    ])
  })

  it('keeps a code and a number exactly as the sheet writes them', async () => {
    const csv =
      'Invoice No:,00042\nItem,SKU,Qty,Unit,Price\nUnsalted Butter,00123,5,kg,9.50\nHeavy Cream,1E5,2,l,3.60\nFlour,10-12-2026,1,kg,1.4\n'
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload.number).toBe('00042')
    expect(payload.items.map((i) => i.sku)).toEqual(['00123', '1E5', '10-12-2026'])
  })

  it('reads the column names vendors actually print', async () => {
    const read = async (csv: string) =>
      (
        await parseInvoiceTable(
          input({
            type: 'invoice',
            fileName: 'inv.csv',
            mimeType: 'text/csv',
            buffer: Buffer.from(csv),
          }),
        )
      ).items
    expect(
      await read(
        'Item #,Item Description,Qty Ship,Pack/Size,Unit Price,Extended Price\n4471,Unsalted Butter,3,1/36 LB,52.10,156.30\n',
      ),
    ).toEqual([
      {
        rawName: 'Unsalted Butter',
        sku: '4471',
        quantity: 3,
        unit: '',
        unitPrice: 52.1,
        lineTotal: 156.3,
      },
    ])
    expect(await read('Item,Description,Qty,Price\n4471,Unsalted Butter,3,9.5\n')).toEqual([
      { rawName: 'Unsalted Butter', quantity: 3, unit: '', unitPrice: 9.5 },
    ])
    expect(
      await read('Item,SKU,Qty,Unit,Unit Cost,Amount\nUnsalted Butter,DD-1147,5,kg,9.50,47.50\n'),
    ).toEqual([
      {
        rawName: 'Unsalted Butter',
        sku: 'DD-1147',
        quantity: 5,
        unit: 'kg',
        unitPrice: 9.5,
        lineTotal: 47.5,
      },
    ])
    expect(
      await read(
        'Product,Code,Quantity Shipped,UOM,Price,Total\nHeavy Cream,HC-2,4,l,3.60,14.40\n',
      ),
    ).toEqual([
      {
        rawName: 'Heavy Cream',
        sku: 'HC-2',
        quantity: 4,
        unit: 'l',
        unitPrice: 3.6,
        lineTotal: 14.4,
      },
    ])
  })

  it('reads no line rather than guess which column is the quantity', async () => {
    const csv = 'Item,Code,Weight,Price\nUnsalted Butter,DD-1147,5,9.50\n'
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload.items).toEqual([])
  })

  it('invents nothing when no header row can be found', async () => {
    const csv = 'just,some,text\nand,more,text\n'
    const payload = await parseInvoiceTable(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload).toEqual({ kind: 'invoice', items: [] })
  })
})

describe('docxToText', () => {
  it('returns the paragraphs of a Word document', async () => {
    const buffer = await docx(['Sysco Foods invoice', 'Beef Tenderloin 2 kg 55.00'])
    const text = await docxToText(input({ fileName: 'inv.docx', mimeType: WORD, buffer }))
    expect(text).toBe('Sysco Foods invoice\nBeef Tenderloin 2 kg 55.00')
  })

  it('gives the text a person reads rather than the markup that stores it', async () => {
    const buffer = await docx([
      'Braised Turnip &amp; Mustard Greens',
      '&lt;2 oz&gt; &quot;Hearth&quot; Broth &#8531;',
    ])
    const text = await docxToText(input({ fileName: 'r.docx', mimeType: WORD, buffer }))
    expect(text).toBe('Braised Turnip & Mustard Greens\n<2 oz> "Hearth" Broth \u2153')
  })

  it('reads a table row by row, pairing the lines a cell stacks with the lines beside them', async () => {
    const para = (text: string) => (text ? `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` : '<w:p/>')
    const cell = (...lines: string[]) => `<w:tc><w:tcPr/>${lines.map(para).join('')}</w:tc>`
    const row = (...cells: string[]) => `<w:tr>${cells.join('')}</w:tr>`
    const table = `<w:tbl><w:tblPr/>${[
      row(cell('Ingredients'), cell('Quantity')),
      row(
        cell('Pancake batter', 'Eggs', 'Whole Milk', 'Salt'),
        cell('', '6ea', '10 cups', 'to taste'),
      ),
      row(cell('Quail Meat, shredded'), cell('1 whole')),
    ].join('')}</w:tbl>`
    const zip = new JSZip()
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="x"><w:body>${para('Yield (12-quarts)')}${table}${para('Note')}</w:body></w:document>`,
    )
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    const text = await docxToText(input({ fileName: 'r.docx', mimeType: WORD, buffer }))
    expect(text).toBe(
      [
        'Yield (12-quarts)',
        'Ingredients | Quantity',
        'Pancake batter',
        'Eggs | 6ea',
        'Whole Milk | 10 cups',
        'Salt | to taste',
        'Quail Meat, shredded | 1 whole',
        'Note',
      ].join('\n'),
    )
  })

  it('reports a file that is not a Word document at all', async () => {
    await expect(
      docxToText(
        input({ fileName: 'broken.docx', mimeType: WORD, buffer: Buffer.from('not a zip') }),
      ),
    ).rejects.toThrow(/Could not read broken\.docx/)
  })
})

describe('textFor', () => {
  it('turns a Word document into the text a model is given', async () => {
    const buffer = await docx(['Northwind Dairy', 'Invoice #W-501'])
    const text = await textFor(input({ fileName: 'inv.docx', mimeType: WORD, buffer }))
    expect(text).toBe('Northwind Dairy\nInvoice #W-501')
  })

  it('turns a spreadsheet into rows rather than the bytes of a zip', async () => {
    const csv = 'Item,Qty\nButter,4\n'
    const text = await textFor(
      input({ fileName: 'inv.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }),
    )
    expect(text).toBe('Item\tQty\nButter\t4')
  })

  it('gives a merged cell its text once, not once for every column it spans', async () => {
    const wb = new Workbook()
    const sheet = wb.addWorksheet('Breakfast')
    sheet.addRows([
      ['Name of Dish: Chorizo Sausage $5', '', '', 'Allergen code:'],
      ['1', 'Chorizo Sausage', '', '6 oz.'],
    ])
    sheet.mergeCells('A1:C1')
    sheet.mergeCells('B2:C2')
    const buffer = Buffer.from(await wb.xlsx.writeBuffer())
    const text = await textFor(input({ fileName: 'r.xlsx', mimeType: SHEET, buffer }))
    expect(text).toBe(
      'Name of Dish: Chorizo Sausage $5\t\t\tAllergen code:\n1\tChorizo Sausage\t\t6 oz.',
    )
  })

  it('leaves plain text alone', async () => {
    const text = await textFor(
      input({
        fileName: 'note.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('two lines\nhere'),
      }),
    )
    expect(text).toBe('two lines\nhere')
  })
})

describe('StubExtractor', () => {
  const extractor = new StubExtractor()

  it('parses a sales spreadsheet through the same seam', async () => {
    const csv = 'item,qty,price\nTaco,4,3.25\n'
    const [{ payload }] = await extractor.extract(
      input({ type: 'sales', fileName: 's.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }),
    )
    expect(payload.kind).toBe('sales')
    expect((payload as { items: unknown[] }).items).toHaveLength(1)
  })

  it('reads an invoice spreadsheet instead of standing in for it', async () => {
    const csv = 'Item,Quantity,Unit,Unit Price\nButter,4,kg,9.5\n'
    const [{ payload }] = await extractor.extract(
      input({
        type: 'invoice',
        fileName: 'inv.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      }),
    )
    expect(payload).toEqual({
      kind: 'invoice',
      items: [{ rawName: 'Butter', quantity: 4, unit: 'kg', unitPrice: 9.5 }],
    })
  })

  it('refuses a spreadsheet it cannot open rather than inventing one', async () => {
    await expect(
      extractor.extract(
        input({
          type: 'invoice',
          fileName: 'inv.xlsx',
          mimeType: SHEET,
          buffer: Buffer.from('not a workbook'),
        }),
      ),
    ).rejects.toThrow(/Could not read inv\.xlsx/)
  })

  it('refuses a Word file rather than inventing one, because it has no model to read prose', async () => {
    const buffer = await docx(['Northwind Dairy', 'Unsalted Butter 8 kg at 9.50'])
    await expect(
      extractor.extract(input({ type: 'invoice', fileName: 'inv.docx', mimeType: WORD, buffer })),
    ).rejects.toThrow(/no extraction model is configured/)
  })

  it('still stands in for a PDF, which only a model can read', async () => {
    const [{ payload }] = await extractor.extract(
      input({
        type: 'invoice',
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4'),
      }),
    )
    expect(payload.kind).toBe('invoice')
  })

  it('echoes a JSON body whose kind matches the document type', async () => {
    const body = JSON.stringify({
      kind: 'invoice',
      number: 'INV-9',
      items: [{ rawName: 'Flour', quantity: 2, unit: 'kg', unitPrice: 1.5 }],
    })
    const results = await extractor.extract(
      input({
        type: 'invoice',
        fileName: 'x.json',
        mimeType: 'application/json',
        buffer: Buffer.from(body),
      }),
    )
    expect(results).toHaveLength(1)
    expect(results[0].payload).toMatchObject({ kind: 'invoice', number: 'INV-9' })
  })

  it('splits a JSON array into one result per document', async () => {
    const body = JSON.stringify([
      { kind: 'invoice', number: 'A', items: [] },
      { kind: 'invoice', number: 'B', items: [] },
      { kind: 'menu', name: 'Ignored', price: 1 },
    ])
    const results = await extractor.extract(
      input({
        type: 'invoice',
        fileName: 'batch.json',
        mimeType: 'application/json',
        buffer: Buffer.from(body),
      }),
    )
    expect(results.map((r) => (r.payload as { number?: string }).number)).toEqual(['A', 'B'])
  })

  it('falls back to a canned payload for an opaque file', async () => {
    const [{ payload }] = await extractor.extract(
      input({ type: 'menu', fileName: 'scan.pdf', mimeType: 'application/pdf' }),
    )
    expect(payload.kind).toBe('menu')
  })
})

describe('prepareInput', () => {
  it('names the type from the extension when the browser sent none', async () => {
    const webp = await prepareInput(input({ fileName: 'menu.WEBP', buffer: Buffer.from('x') }))
    expect(webp.mimeType).toBe('image/webp')
    const doc = await prepareInput(
      input({ fileName: 'recipe.doc', mimeType: '', buffer: Buffer.from('x') }),
    )
    expect(doc.mimeType).toBe('application/msword')
  })

  it('keeps a type the browser did send', async () => {
    const png = await prepareInput(
      input({ fileName: 'scan.bin', mimeType: 'image/png', buffer: Buffer.from('x') }),
    )
    expect(png.mimeType).toBe('image/png')
  })

  it('turns an AVIF image into a PNG, which every model reads', async () => {
    const avif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
      .avif()
      .toBuffer()
    const out = await prepareInput(
      input({ fileName: 'invoice.avif', mimeType: 'image/avif', buffer: avif }),
    )
    expect(out.mimeType).toBe('image/png')
    expect(out.buffer.subarray(1, 4).toString('latin1')).toBe('PNG')
  })

  it('reports an AVIF that cannot be decoded', async () => {
    await expect(
      prepareInput(
        input({
          fileName: 'broken.avif',
          mimeType: 'image/avif',
          buffer: Buffer.from('not an image'),
        }),
      ),
    ).rejects.toThrow('Could not read broken.avif')
  })
})

describe('Word 97 documents', () => {
  const fixture = readFileSync(join(__dirname, '../../../test/fixtures/brown-butter-sauce.doc'))

  it('turns a .doc file into its text', async () => {
    const text = await textFor(
      input({
        fileName: 'Brown Butter Sauce.DOC',
        mimeType: 'application/msword',
        buffer: fixture,
      }),
    )
    expect(text).toContain('Brown Butter Sauce')
    expect(text).toContain('200\tg\tUnsalted Butter')
  })

  it('reads the UTF-16 text runs of a file whose body the reader cannot find', () => {
    const run = (t: string) => Buffer.from(t, 'utf16le')
    const raw = Buffer.concat([
      Buffer.from([0, 1, 2, 3]),
      run('Whole wheat flour'),
      Buffer.from([0, 0, 9]),
      run('Milk'),
    ])
    expect(utf16Text(raw)).toBe('Whole wheat flour\nMilk')
  })

  it('reports a file that is not a Word document at all', async () => {
    await expect(
      textFor(
        input({
          fileName: 'fake.doc',
          mimeType: 'application/msword',
          buffer: Buffer.from('plain'),
        }),
      ),
    ).rejects.toThrow('Could not read fake.doc')
  })
})

describe('workbooks with many sheets', () => {
  const recipeSheet = (name: string) => [
    [name],
    ['Ingredient', 'Qty', 'Unit'],
    ['Butter', 2, 'kg'],
    ['Flour', 1, 'kg'],
  ]

  it('gives the model every sheet, each under its own name', async () => {
    const buffer = await workbook({
      Contents: [['1', 'Soup']],
      Soup: recipeSheet('Soup'),
      Empty: [],
      Stew: recipeSheet('Stew'),
    })
    const chunks = await textChunks(
      input({ type: 'recipe', fileName: 'book.xlsx', mimeType: SHEET, buffer }),
    )
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain('Sheet: Contents')
    expect(chunks[0]).toContain('Sheet: Soup\nSoup')
    expect(chunks[0]).toContain('Sheet: Stew\nStew')
    expect(chunks[0]).not.toContain('Sheet: Empty')
  })

  it('gives what a cell shows, not how the workbook stores it', async () => {
    const buffer = await workbook({
      '66': [
        [null, { formula: "'Contents'!B76", result: 'High Altitude Coconut Cake' }],
        ['ct', 'Ingredients', 'Unit'],
        [
          { formula: 'A4+1', result: 2 },
          { richText: [{ text: 'Whole ' }, { text: 'Butter' }] },
          'lbs',
        ],
        [3, 'Kosher Salt', { formula: 'C4*E4' }],
        [4, { text: 'Coco Lopez', hyperlink: 'https://example.com' }, { error: '#REF!' }],
      ],
    })
    const text = await textFor(
      input({ type: 'recipe', fileName: 'book.xlsx', mimeType: SHEET, buffer }),
    )
    expect(text).not.toContain('[object Object]')
    expect(text).toBe(
      '\tHigh Altitude Coconut Cake\nct\tIngredients\tUnit\n2\tWhole Butter\tlbs\n3\tKosher Salt\t\n4\tCoco Lopez\t',
    )
  })

  it('splits a large workbook into parts that each fit, without losing a row', async () => {
    const sheets: Record<string, unknown[][]> = {}
    for (let i = 1; i <= 30; i++) sheets[`R${i}`] = recipeSheet(`Recipe ${i}`)
    const buffer = await workbook(sheets)
    const chunks = await textChunks(
      input({ type: 'recipe', fileName: 'book.xlsx', mimeType: SHEET, buffer }),
      300,
    )
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(300)
    const all = chunks.join('\n')
    for (let i = 1; i <= 30; i++) expect(all).toContain(`Recipe ${i}\n`)
  })

  it('splits one sheet larger than a part by its rows', async () => {
    const rows = [['Big'], ...Array.from({ length: 60 }, (_, i) => [`Ingredient ${i}`, i, 'g'])]
    const buffer = await workbook({ Big: rows })
    const chunks = await textChunks(
      input({ type: 'recipe', fileName: 'book.xlsx', mimeType: SHEET, buffer }),
      400,
    )
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.startsWith('Sheet: Big'))).toBe(true)
    expect(chunks.join('\n')).toContain('Ingredient 59\t59\tg')
  })

  it('refuses a workbook too large to read in a reasonable number of parts', async () => {
    const sheets: Record<string, unknown[][]> = {}
    for (let i = 1; i <= 40; i++) sheets[`R${i}`] = recipeSheet(`Recipe ${i}`)
    const buffer = await workbook(sheets)
    await expect(
      textChunks(input({ type: 'recipe', fileName: 'huge.xlsx', mimeType: SHEET, buffer }), 100, 3),
    ).rejects.toThrow(
      'Could not read huge.xlsx: it is too large to read in one upload; split it into smaller workbooks',
    )
  })

  it('finds an invoice table on a later sheet', async () => {
    const buffer = await workbook({
      Notes: [['Delivered on Monday']],
      Invoice: [
        ['Dairy Direct'],
        ['Item', 'Quantity', 'Unit', 'Unit Price'],
        ['Butter', 4, 'kg', 9.5],
      ],
    })
    const payload = await parseInvoiceTable(
      input({ fileName: 'inv.xlsx', mimeType: SHEET, buffer }),
    )
    expect(payload.items).toEqual([{ rawName: 'Butter', quantity: 4, unit: 'kg', unitPrice: 9.5 }])
    expect(payload.vendorName).toBe('Dairy Direct')
  })

  it('finds a sales table on a later sheet', async () => {
    const buffer = await workbook({
      Summary: [['Week 38']],
      Sales: [
        ['Menu Item', 'Quantity', 'Unit Price'],
        ['Burger', 3, 9.5],
      ],
    })
    const [payload] = await parseSalesTables(
      input({ type: 'sales', fileName: 's.xlsx', mimeType: SHEET, buffer }),
    )
    expect(payload.items).toEqual([{ menuItemName: 'Burger', quantity: 3, unitPrice: 9.5 }])
  })
})

describe('model extractors', () => {
  type Call = { url: string; init: RequestInit; body: unknown }

  const at = (value: unknown, ...path: (string | number)[]): unknown =>
    path.reduce<unknown>(
      (node, key) => (node as Record<string | number, unknown> | undefined)?.[key],
      value,
    )

  const recording = (answer: unknown, status = 200) => {
    const calls: Call[] = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init, body: JSON.parse(init.body as string) })
      return new Response(typeof answer === 'string' ? answer : JSON.stringify(answer), { status })
    }) as unknown as typeof fetch
    return { calls, fake }
  }

  const pdf = input({
    type: 'invoice',
    fileName: 'scan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  })
  const invoice = {
    vendorName: 'Dairy Direct',
    items: [{ rawName: 'Butter', quantity: 4, unit: 'kg', unitPrice: 9.5 }],
  }

  it('asks Claude for the documents in a JSON schema, with the file as a document, and reads the answer back', async () => {
    const { calls, fake } = recording({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({ documents: [invoice, { ...invoice, number: '2' }] }),
        },
      ],
    })
    const results = await new ClaudeExtractor({
      apiKey: 'test-key',
      model: 'claude-opus-5-5',
      effort: 'low',
      fetch: fake,
    }).extract(pdf)

    expect(results.map((r) => r.payload)).toEqual([
      { ...invoice, kind: 'invoice' },
      { ...invoice, number: '2', kind: 'invoice' },
    ])
    expect(calls).toHaveLength(1)
    const [{ url, init, body }] = calls
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers).toMatchObject({
      'x-api-key': 'test-key',
      'anthropic-version': '2023-06-01',
    })
    expect(at(body, 'model')).toBe('claude-opus-5-5')
    for (const unsent of ['temperature', 'top_p', 'thinking', 'tools', 'tool_choice'])
      expect(at(body, unsent)).toBeUndefined()
    expect(at(body, 'output_config', 'effort')).toBe('low')
    expect(at(body, 'output_config', 'format', 'type')).toBe('json_schema')
    const schema = at(body, 'output_config', 'format', 'schema')
    expect(at(schema, 'additionalProperties')).toBe(false)
    const line = at(schema, 'properties', 'documents', 'items', 'properties', 'items', 'items')
    expect(at(line, 'properties', 'quantity')).toEqual({ type: 'number' })
    expect(at(line, 'additionalProperties')).toBe(false)
    expect(at(body, 'messages', 0, 'content', 0)).toEqual({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: Buffer.from('%PDF-1.4').toString('base64'),
      },
    })
  })

  it('lets a recipe line state no amount, in both schema dialects, and asks for it not to be dropped', async () => {
    const recipePdf = input({
      type: 'recipe',
      fileName: 'r.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4'),
    })
    const g = recording({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ documents: [] }) }] } }],
    })
    await new GeminiExtractor({ apiKey: 'k', model: 'm', fetch: g.fake }).extract(recipePdf)
    const line = at(
      g.calls[0].body,
      'generationConfig',
      'responseSchema',
      'properties',
      'documents',
      'items',
      'properties',
      'items',
      'items',
    )
    expect(at(line, 'required')).toEqual(['rawName'])
    expect(at(line, 'properties', 'quantity')).toEqual({ type: 'NUMBER', nullable: true })
    expect(at(line, 'properties', 'note')).toEqual({ type: 'STRING' })
    expect(String(at(g.calls[0].body, 'contents', 0, 'parts', 0, 'text'))).toContain(
      'never drop such a line and never write 0 for it',
    )

    const c = recording({ content: [{ type: 'text', text: JSON.stringify({ documents: [] }) }] })
    await new ClaudeExtractor({ apiKey: 'k', model: 'm', fetch: c.fake }).extract(recipePdf)
    expect(
      at(
        c.calls[0].body,
        'output_config',
        'format',
        'schema',
        'properties',
        'documents',
        'items',
        'properties',
        'items',
        'items',
        'properties',
        'quantity',
      ),
    ).toEqual({ type: ['number', 'null'] })
  })

  it('says so when Claude declines to read a file', async () => {
    const declined = recording({ stop_reason: 'refusal', content: [] })
    await expect(
      new ClaudeExtractor({ apiKey: 'k', model: 'm', fetch: declined.fake }).extract(pdf),
    ).rejects.toThrow('Claude declined to read this file')
  })

  it('hands Claude an image as an image and a Word file as its text', async () => {
    const { calls, fake } = recording({
      content: [{ type: 'text', text: JSON.stringify({ documents: [] }) }],
    })
    const claude = new ClaudeExtractor({ apiKey: 'k', model: 'm', fetch: fake })
    await claude.extract(
      input({ fileName: 'a.png', mimeType: 'image/png', buffer: Buffer.from('png') }),
    )
    await claude.extract(
      input({ fileName: 'a.docx', mimeType: WORD, buffer: await docx(['Butter 4 kg']) }),
    )
    expect(at(calls[0].body, 'messages', 0, 'content', 0)).toMatchObject({
      type: 'image',
      source: { media_type: 'image/png' },
    })
    expect(at(calls[1].body, 'messages', 0, 'content', 0)).toEqual({
      type: 'text',
      text: 'Butter 4 kg',
    })
  })

  it('reads a spreadsheet itself and spends no model call on it, whichever model is chosen', async () => {
    const csv = input({
      fileName: 'inv.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Item,Quantity,Unit,Unit Price\nButter,4,kg,9.5\n'),
    })
    const claude = recording({})
    const gemini = recording({})
    await new ClaudeExtractor({ apiKey: 'k', model: 'm', fetch: claude.fake }).extract(csv)
    await new GeminiExtractor({ apiKey: 'k', model: 'm', fetch: gemini.fake }).extract(csv)
    expect(claude.calls).toHaveLength(0)
    expect(gemini.calls).toHaveLength(0)
  })

  it('hands a model the sales sheet it could not read itself', async () => {
    const csv = input({
      type: 'sales',
      fileName: 's.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Dish sold,Covers\nSoup,4\n'),
    })
    const sales = {
      date: '2026-09-30',
      items: [{ menuItemName: 'Soup', quantity: 4, unitPrice: 6 }],
    }
    const gemini = recording({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ documents: [sales] }) }] } }],
    })
    const results = await new GeminiExtractor({
      apiKey: 'k',
      model: 'm',
      fetch: gemini.fake,
    }).extract(csv)
    expect(gemini.calls).toHaveLength(1)
    expect(results.map((r) => r.payload)).toEqual([{ ...sales, kind: 'sales' }])
  })

  it('hands a model the sheet it could not read itself', async () => {
    const csv = input({
      fileName: 'inv.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Item,Code,Weight,Price\nButter,DD-1,4,9.5\n'),
    })
    const gemini = recording({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ documents: [invoice] }) }] } }],
    })
    const results = await new GeminiExtractor({
      apiKey: 'k',
      model: 'm',
      fetch: gemini.fake,
    }).extract(csv)
    expect(gemini.calls).toHaveLength(1)
    expect(results.map((r) => r.payload)).toEqual([{ ...invoice, kind: 'invoice' }])
  })

  it('fails the job with the provider status, and when the model answers without the documents', async () => {
    const refused = recording('{"error":{"type":"authentication_error"}}', 401)
    await expect(
      new ClaudeExtractor({ apiKey: 'k', model: 'm', fetch: refused.fake }).extract(pdf),
    ).rejects.toThrow(/Claude 401: .*authentication_error/)
    const silent = recording({ content: [] })
    await expect(
      new ClaudeExtractor({ apiKey: 'k', model: 'm', fetch: silent.fake }).extract(pdf),
    ).rejects.toThrow('Claude returned no content')
    const shapeless = recording({ content: [{ type: 'text', text: JSON.stringify({ invoice }) }] })
    await expect(
      new ClaudeExtractor({ apiKey: 'k', model: 'm', fetch: shapeless.fake }).extract(pdf),
    ).rejects.toThrow('Claude returned no documents')
  })

  it('marks a refusal a second attempt cannot change, and leaves a busy or failing provider to be tried again', async () => {
    const outcome = async (answer: unknown, status: number) =>
      new GeminiExtractor({ apiKey: 'k', model: 'm', fetch: recording(answer, status).fake })
        .extract(pdf)
        .then(
          () => 'read',
          (e: Error) => (e instanceof ExtractionRefused ? 'refused' : 'again'),
        )
    expect(await outcome('{"error":"bad request"}', 400)).toBe('refused')
    expect(await outcome('{"error":"forbidden"}', 403)).toBe('refused')
    expect(await outcome('{"error":"slow down"}', 429)).toBe('again')
    expect(await outcome('{"error":"unavailable"}', 503)).toBe('again')
    expect(
      await outcome({ candidates: [{ content: { parts: [{ text: '{"documents": [' }] } }] }, 200),
    ).toBe('refused')
  })

  it('gives a model call a deadline', async () => {
    const { calls, fake } = recording({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ documents: [invoice] }) }] } }],
    })
    await new GeminiExtractor({ apiKey: 'k', model: 'm', fetch: fake }).extract(pdf)
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
  })

  it('asks for dates the calendar can read, and for sold dishes rather than the totals around them', async () => {
    const { calls, fake } = recording({
      content: [{ type: 'text', text: JSON.stringify({ documents: [] }) }],
    })
    const claude = new ClaudeExtractor({ apiKey: 'k', model: 'm', fetch: fake })
    await claude.extract(
      input({
        type: 'sales',
        fileName: 'day.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('jpg'),
      }),
    )
    await claude.extract(pdf)
    const text = (call: Call) => String(at(call.body, 'messages', 0, 'content', 1, 'text'))
    expect(text(calls[0])).toContain('as YYYY-MM-DD')
    expect(text(calls[0])).toMatch(/not a menu item \(category or department totals, taxes/)
    expect(text(calls[1])).toContain('invoiceDate as YYYY-MM-DD')
  })

  it('reads a recipe workbook one part at a time and returns what every part found', async () => {
    const sheets: Record<string, unknown[][]> = {}
    for (let i = 1; i <= 12; i++)
      sheets[`R${i}`] = [
        [`Recipe ${i}`],
        ...Array.from({ length: 200 }, (_, j) => [`Item ${j}`, j, 'g']),
      ]
    const buffer = await workbook(sheets)
    const recipe = (name: string) => ({ name, portions: 1, items: [] })
    let n = 0
    const calls: unknown[] = []
    const fake = (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(init.body as string))
      n += 1
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify({ documents: [recipe(`R${n}`)] }) }] } },
          ],
        }),
      )
    }) as unknown as typeof fetch
    const results = await new GeminiExtractor({ apiKey: 'k', model: 'm', fetch: fake }).extract(
      input({ type: 'recipe', fileName: 'book.xlsx', mimeType: SHEET, buffer }),
    )
    expect(calls.length).toBeGreaterThan(1)
    expect(results).toHaveLength(calls.length)
    expect(at(calls[0], 'contents', 0, 'parts', 0, 'text')).toContain('Sheets that hold no recipe')
    expect(String(at(calls[1], 'contents', 0, 'parts', 1, 'text'))).toMatch(/^Sheet: R\d+/)
  })

  it('hands a model a Word 97 file as its text', async () => {
    const { calls, fake } = recording({
      content: [{ type: 'text', text: JSON.stringify({ documents: [] }) }],
    })
    const fixture = readFileSync(join(__dirname, '../../../test/fixtures/brown-butter-sauce.doc'))
    await new ClaudeExtractor({ apiKey: 'k', model: 'm', fetch: fake }).extract(
      input({
        type: 'recipe',
        fileName: 'sauce.doc',
        mimeType: 'application/msword',
        buffer: fixture,
      }),
    )
    expect(String(at(calls[0].body, 'messages', 0, 'content', 0, 'text'))).toContain(
      'Unsalted Butter',
    )
  })

  it('asks Gemini for the same shape in its own schema dialect', async () => {
    const { calls, fake } = recording({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ documents: [invoice] }) }] } }],
    })
    const results = await new GeminiExtractor({
      apiKey: 'g-key',
      model: 'gemini-x',
      fetch: fake,
    }).extract(pdf)
    expect(results[0].payload).toEqual({ ...invoice, kind: 'invoice' })
    expect(calls[0].url).toContain('/models/gemini-x:generateContent?key=g-key')
    expect(
      at(calls[0].body, 'generationConfig', 'responseSchema', 'properties', 'documents', 'type'),
    ).toBe('ARRAY')
    expect(at(calls[0].body, 'contents', 0, 'parts', 1)).toEqual({
      inline_data: {
        mime_type: 'application/pdf',
        data: Buffer.from('%PDF-1.4').toString('base64'),
      },
    })
  })
})

describe('the pair: a draft read by one model and checked by another', () => {
  type Call = { url: string; body: Record<string, unknown> }
  const at = (value: unknown, ...path: (string | number)[]): unknown =>
    path.reduce<unknown>(
      (node, key) => (node as Record<string | number, unknown> | undefined)?.[key],
      value,
    )
  const gemini = (json: unknown, finishReason = 'STOP') => ({
    candidates: [
      {
        finishReason,
        content: {
          parts: [
            { text: 'thinking it over', thought: true },
            { text: typeof json === 'string' ? json : JSON.stringify(json) },
          ],
        },
      },
    ],
  })
  const replying = (...answers: { body: unknown; status?: number }[]) => {
    const calls: Call[] = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) })
      const next = answers[calls.length - 1] ?? answers[answers.length - 1]
      return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
    }) as unknown as typeof fetch
    return { calls, fake }
  }
  const pdf = input({
    type: 'recipe',
    fileName: 'book.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  })
  const toast = { name: 'Toast', items: [{ rawName: 'Bread', quantity: 1, unit: 'ea' }] }
  const soup = { name: 'Soup', items: [{ rawName: 'Leek', quantity: 2, unit: 'ea' }] }
  const total = { name: 'Total', items: [{ rawName: 'Food cost', quantity: 1, unit: '' }] }
  const pair = (fake: typeof fetch, warn: (m: string) => void = () => {}) =>
    new PairExtractor({
      apiKey: 'k',
      draftModel: 'gemini-3.5-flash-lite',
      reviewModel: 'gemini-3.8-flash',
      fetch: fake,
      warn,
    })

  it('asks the cheap model for a draft, the strong one for corrections only, and merges them', async () => {
    const fixedToast = {
      ...toast,
      items: [{ rawName: 'Sourdough Bread', quantity: 2, unit: 'slice' }],
    }
    const { calls, fake } = replying(
      { body: gemini({ documents: [toast, total] }) },
      {
        body: gemini({ add: [soup], remove: [1], replace: [{ id: 0, document: fixedToast }] }),
      },
    )
    const results = await pair(fake).extract(pdf)

    expect(results.map((r) => r.payload)).toEqual([
      { ...fixedToast, kind: 'recipe' },
      { ...soup, kind: 'recipe' },
    ])
    expect(calls.map((c) => c.url.split('/models/')[1].split(':')[0])).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash',
    ])
    expect(at(calls[0].body, 'generationConfig', 'responseSchema', 'properties')).toHaveProperty(
      'documents',
    )
    const review = calls[1].body
    expect(
      Object.keys(at(review, 'generationConfig', 'responseSchema', 'properties') as object),
    ).toEqual(['add', 'remove', 'replace'])
    expect(at(review, 'generationConfig', 'thinkingConfig')).toEqual({ thinkingLevel: 'low' })
    const prompt = String(at(review, 'contents', 0, 'parts', 0, 'text'))
    expect(prompt).toContain('The DOCUMENT is the source of truth')
    expect(prompt).toContain('"id":0')
    expect(prompt).toContain('"id":1')
    expect(at(review, 'contents', 0, 'parts', 1)).toEqual(
      at(calls[0].body, 'contents', 0, 'parts', 1),
    )
  })

  it('keeps the draft and says why when the check fails, is cut short or answers what it cannot read', async () => {
    for (const second of [
      { body: { error: 'unavailable' }, status: 503 },
      { body: gemini({ add: [soup], remove: [], replace: [] }, 'MAX_TOKENS') },
      { body: gemini('{"add": [') },
      { body: gemini({ add: [], remove: [7], replace: [{ id: 9, document: soup }] }) },
    ]) {
      const warned: string[] = []
      const { fake } = replying({ body: gemini({ documents: [toast] }) }, second)
      const results = await pair(fake, (m) => warned.push(m)).extract(pdf)
      expect(results.map((r) => r.payload)).toEqual([{ ...toast, kind: 'recipe' }])
      if (second.status) expect(warned[0]).toMatch(/check by gemini-3.8-flash failed/)
    }
  })

  it('tells the check what not to change: a number restated, a sub-recipe name, a heading taken for a dish', async () => {
    const { calls, fake } = replying(
      { body: gemini({ documents: [toast] }) },
      { body: gemini({ add: [], remove: [], replace: [] }) },
    )
    await pair(fake).extract(pdf)
    const prompt = String(at(calls[1].body, 'contents', 0, 'parts', 0, 'text'))
    expect(prompt).toContain('Do not replace an entry only to restate a number')
    expect(prompt).toContain("keeps the sub-recipe's name exactly")
    expect(prompt).toContain('a stray letter, a heading or a station name is not')
    expect(prompt).toContain('every line the paper lists for it')
  })

  it('keeps a line naming a sub-recipe under that name when the check renames it', async () => {
    const chop = {
      name: 'Piri-Piri Pork Chop Plate',
      items: [
        { rawName: 'Piri-Piri Pork Chop', quantity: 1, unit: 'portion' },
        { rawName: 'Rice', quantity: 1, unit: 'cup' },
      ],
      subRecipes: [
        { name: 'Piri-Piri Pork Chop', items: [{ rawName: 'Pork', quantity: 1, unit: 'ea' }] },
      ],
    }
    const renamed = {
      ...chop,
      items: [
        { rawName: 'Grilled Piri-Piri Pork Chop', quantity: 1, unit: 'portion' },
        { rawName: 'Jasmine Rice', quantity: 1, unit: 'cup' },
      ],
    }
    const { fake } = replying(
      { body: gemini({ documents: [chop] }) },
      { body: gemini({ add: [], remove: [], replace: [{ id: 0, document: renamed }] }) },
    )
    const [result] = await pair(fake).extract(pdf)
    expect((result.payload as typeof chop).items.map((l) => l.rawName)).toEqual([
      'Piri-Piri Pork Chop',
      'Jasmine Rice',
    ])
  })

  it('asks the check once more when the provider is busy, before keeping the draft', async () => {
    const { calls, fake } = replying(
      { body: gemini({ documents: [toast] }) },
      { body: { error: 'busy' }, status: 429 },
      { body: gemini({ add: [soup], remove: [], replace: [] }) },
    )
    const results = await pair(fake).extract(pdf)
    expect(calls).toHaveLength(3)
    expect(results.map((r) => (r.payload as { name: string }).name)).toEqual(['Toast', 'Soup'])
  })

  it('fails the job as a single model would when the draft itself cannot be read', async () => {
    const { calls, fake } = replying({
      body: { error: { status: 'PERMISSION_DENIED' } },
      status: 403,
    })
    await expect(pair(fake).extract(pdf)).rejects.toThrow(ExtractionRefused)
    expect(calls).toHaveLength(1)
  })
})

describe('reading the edges of a file', () => {
  it('reads a CSV saved in big-endian UTF-16', async () => {
    const le = Buffer.from('Item,Qty,Unit price\nCrème fraîche,2,4.5\n', 'utf16le')
    const be = Buffer.alloc(le.length)
    for (let i = 0; i < le.length; i += 2) {
      be[i] = le[i + 1]
      be[i + 1] = le[i]
    }
    const csv = input({
      fileName: 'be.csv',
      mimeType: 'text/csv',
      buffer: Buffer.concat([Buffer.from([0xfe, 0xff]), be]),
    })
    expect((await parseInvoiceTable(csv)).items).toEqual([
      expect.objectContaining({ rawName: 'Crème fraîche', quantity: 2, unitPrice: 4.5 }),
    ])
  })

  it('takes the day of a sales report from a date and time printed above the header', async () => {
    const at = new Date(2026, 8, 10, 15, 30)
    const sheet = input({
      type: 'sales',
      fileName: 'day.xlsx',
      mimeType: SHEET,
      buffer: await workbook({ Sales: [[at], ['Item', 'Qty', 'Price'], ['Soup', 2, 5]] }),
    })
    expect(await parseSalesTables(sheet)).toEqual([
      { kind: 'sales', date: at.toISOString().slice(0, 10), items: [expect.anything()] },
    ])
  })

  it('reads a sales sheet with a header and no lines as a report with nothing sold', async () => {
    const csv = input({
      type: 'sales',
      fileName: 'empty.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Item,Qty,Price\n'),
    })
    expect(await parseSalesTables(csv)).toEqual([{ kind: 'sales', items: [] }])
  })

  it('reports a zip that carries no Word document', async () => {
    const zip = new JSZip()
    zip.file('notes.txt', 'not a document')
    const file = input({
      fileName: 'empty.docx',
      mimeType: WORD,
      buffer: await zip.generateAsync({ type: 'nodebuffer' }),
    })
    await expect(docxToText(file)).rejects.toThrow(/no word\/document\.xml inside/)
  })

  it('turns a character written as a hexadecimal entity into the character', async () => {
    const file = input({
      fileName: 'hex.docx',
      mimeType: WORD,
      buffer: await docx(['Cr&#xE8;me &#x26; butter']),
    })
    expect(await docxToText(file)).toBe('Crème & butter')
  })

  it('reports a Gemini answer that carries no content', async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ candidates: [] }), { status: 200 })) as unknown as typeof fetch
    const pdf = input({
      fileName: 'scan.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4'),
    })
    await expect(
      new GeminiExtractor({ apiKey: 'k', model: 'm', fetch: fake }).extract(pdf),
    ).rejects.toThrow('Gemini returned no content')
  })
})
