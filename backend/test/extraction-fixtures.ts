import type { ExtractInput, ExtractionPayload } from '../src/modules/documents/extraction'

export interface Fixture {
  name: string
  input: ExtractInput
  expected: ExtractionPayload
}

const text = (type: ExtractInput['type'], fileName: string, body: string): ExtractInput => ({
  type,
  fileName,
  mimeType: fileName.endsWith('.csv') ? 'text/csv' : 'text/plain',
  buffer: Buffer.from(body),
})

export const FIXTURES: Fixture[] = [
  {
    name: 'invoice — single line',
    input: text(
      'invoice',
      'sunrise.txt',
      `SUNRISE PRODUCE CO.
Invoice #A-100    Date: 2026-08-01
10 kg   Yellow Onions   1.20 per kg`,
    ),
    expected: {
      kind: 'invoice',
      vendorName: 'Sunrise Produce Co.',
      number: 'A-100',
      invoiceDate: '2026-08-01',
      items: [{ rawName: 'Yellow Onions', quantity: 10, unit: 'kg', unitPrice: 1.2 }],
    },
  },
  {
    name: 'invoice — two lines',
    input: text(
      'invoice',
      'harbor.txt',
      `HARBOR MEATS
Invoice #B-200    Date: 2026-08-02
6 kg    Ground Beef     8.75
4 kg    Chicken Thigh   5.10`,
    ),
    expected: {
      kind: 'invoice',
      vendorName: 'Harbor Meats',
      number: 'B-200',
      invoiceDate: '2026-08-02',
      items: [
        { rawName: 'Ground Beef', quantity: 6, unit: 'kg', unitPrice: 8.75 },
        { rawName: 'Chicken Thigh', quantity: 4, unit: 'kg', unitPrice: 5.1 },
      ],
    },
  },
  {
    name: 'recipe — with yield and ingredients',
    input: text(
      'recipe',
      'sauce.txt',
      `Recipe: Marinara Sauce
Yields 4 litres, 10 portions.
San Marzano Tomatoes  3 kg
Olive Oil (Extra Virgin)  0.2 l`,
    ),
    expected: {
      kind: 'recipe',
      name: 'Marinara Sauce',
      portions: 10,
      yieldQty: 4,
      yieldUnit: 'litres',
      items: [
        { rawName: 'San Marzano Tomatoes', quantity: 3, unit: 'kg' },
        { rawName: 'Olive Oil (Extra Virgin)', quantity: 0.2, unit: 'l' },
      ],
    },
  },
  {
    name: 'menu: sections and dishes',
    input: text(
      'menu',
      'dinner.txt',
      `Dinner Menu
Mains
Steak Frites $34.00
Roast Chicken $26.00
Desserts
Lemon Tart $9.00`,
    ),
    expected: {
      kind: 'menu',
      name: 'Dinner Menu',
      items: [
        { name: 'Steak Frites', price: 34, section: 'Mains' },
        { name: 'Roast Chicken', price: 26, section: 'Mains' },
        { name: 'Lemon Tart', price: 9, section: 'Desserts' },
      ],
    },
  },
  {
    name: 'invoice — CSV (parsed locally)',
    input: text(
      'invoice',
      'northwind.csv',
      'Northwind Dairy,,,,,\nInvoice #C-300,,,,,\nItem,SKU,Quantity,Unit,Unit Price,Total Price\nUnsalted Butter,ND-114,8,kg,9.5,76\nHeavy Cream,,12,l,3.2,36.90\n',
    ),
    expected: {
      kind: 'invoice',
      vendorName: 'Northwind Dairy',
      number: 'C-300',
      items: [
        {
          rawName: 'Unsalted Butter',
          sku: 'ND-114',
          quantity: 8,
          unit: 'kg',
          unitPrice: 9.5,
          lineTotal: 76,
        },
        { rawName: 'Heavy Cream', quantity: 12, unit: 'l', unitPrice: 3.2, lineTotal: 36.9 },
      ],
    },
  },
  {
    name: 'sales — CSV (parsed locally)',
    input: text(
      'sales',
      'day.csv',
      'Menu Item,Quantity,Unit Price\nSteak Frites,12,34\nHouse Salad,7,11.5\n',
    ),
    expected: {
      kind: 'sales',
      items: [
        { menuItemName: 'Steak Frites', quantity: 12, unitPrice: 34 },
        { menuItemName: 'House Salad', quantity: 7, unitPrice: 11.5 },
      ],
    },
  },
]
