import 'dotenv/config'
import * as argon2 from 'argon2'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { recalcOrganizationWith } from '../src/costing/costing.service'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

const PASSWORD = 'Nexus_dev1'

async function main() {
  console.log('— resetting database…')
  await prisma.purchaseDraftLine.deleteMany()
  await prisma.purchaseDraft.deleteMany()
  await prisma.saleItem.deleteMany()
  await prisma.sale.deleteMany()
  await prisma.production.deleteMany()
  await prisma.wasteEntry.deleteMany()
  await prisma.inventoryTransaction.deleteMany()
  await prisma.menuItemOnMenu.deleteMany()
  await prisma.menuOnLocation.deleteMany()
  await prisma.menu.deleteMany()
  await prisma.menuItemRecipe.deleteMany()
  await prisma.menuItem.deleteMany()
  await prisma.recipeComponent.deleteMany()
  await prisma.recipeIngredient.deleteMany()
  await prisma.instruction.deleteMany()
  await prisma.recipeSection.deleteMany()
  await prisma.recipe.deleteMany()
  await prisma.invoiceItem.deleteMany()
  await prisma.invoice.deleteMany()
  await prisma.ingredientPriceHistory.deleteMany()
  await prisma.ingredientLocationSettings.deleteMany()
  await prisma.ingredientLocationStock.deleteMany()
  await prisma.ingredient.deleteMany()
  await prisma.category.deleteMany()
  await prisma.vendor.deleteMany()
  await prisma.invitation.deleteMany()
  await prisma.userLocation.deleteMany()
  await prisma.user.deleteMany()
  await prisma.location.deleteMany()
  await prisma.organization.deleteMany()

  const hashed = await argon2.hash(PASSWORD)

  console.log('— Org A: The Golden Fork Group…')
  const orgA = await prisma.organization.create({
    data: {
      name: 'The Golden Fork Group',
      slug: 'golden-fork',
      ownerName: 'Alex Morgan',
      ownerEmail: 'owner@goldenfork.com',
      subscriptionStatus: 'trial',
      trialEndsAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      city: 'San Francisco',
      state: 'CA',
      country: 'US',
    },
  })

  const [downtown, riverside, airport] = await Promise.all(
    ['Golden Fork — Downtown', 'Golden Fork — Riverside', 'Golden Fork — Airport'].map((name, i) =>
      prisma.location.create({
        data: { organizationId: orgA.id, name, isDefault: i === 0 },
      }),
    ),
  )

  const [alex, maria, ken] = await Promise.all([
    prisma.user.create({
      data: {
        organizationId: orgA.id,
        email: 'owner@goldenfork.com',
        hashedPassword: hashed,
        fullName: 'Alex Morgan',
        role: 'owner',
        emailVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        organizationId: orgA.id,
        email: 'maria@goldenfork.com',
        hashedPassword: hashed,
        fullName: 'Maria Silva',
        role: 'manager',
        emailVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        organizationId: orgA.id,
        email: 'ken@goldenfork.com',
        hashedPassword: hashed,
        fullName: 'Ken Tanaka',
        role: 'staff',
        emailVerified: true,
      },
    }),
  ])
  await prisma.userLocation.createMany({
    data: [
      { userId: maria.id, locationId: downtown.id },
      { userId: ken.id, locationId: downtown.id },
      { userId: ken.id, locationId: riverside.id },
    ],
  })

  const vendorNames = [
    ['Prime Meats Co.', 'orders@primemeats.com', '(555) 010-1234'],
    ['Mediterraneo Imports', 'sales@mediterraneo.com', '(555) 010-5678'],
    ['Dairy Direct', 'support@dairydirect.com', '(555) 010-9012'],
    ['Green Valley Produce', 'hello@greenvalley.farm', '(555) 010-3456'],
  ] as const
  const vendorsA = await Promise.all(
    vendorNames.map(([name, contact, phone], i) =>
      prisma.vendor.create({
        data: {
          organizationId: orgA.id,
          name,
          contact,
          phone,
          status: i === 3 ? 'inactive' : 'active',
        },
      }),
    ),
  )

  const catNames: [string, 'ingredient' | 'recipe' | 'menu'][] = [
    ['Meat & Poultry', 'ingredient'],
    ['Produce', 'ingredient'],
    ['Dairy', 'ingredient'],
    ['Dry Goods', 'ingredient'],
    ['Seafood', 'ingredient'],
    ['Oils & Fats', 'ingredient'],
    ['Mains', 'recipe'],
    ['Components', 'recipe'],
    ['Desserts', 'recipe'],
    ['Mains', 'menu'],
    ['Salads', 'menu'],
    ['Appetizers', 'menu'],
    ['Desserts', 'menu'],
    ['Beverages', 'menu'],
  ]
  const catsA = new Map<string, string>()
  for (const [name, kind] of catNames) {
    const c = await prisma.category.create({
      data: { organizationId: orgA.id, name, kind },
    })
    catsA.set(`${kind}:${name}`, c.id)
  }

  const ing = async (
    name: string,
    unit: string,
    costPerUnit: number,
    onHand: number,
    reorderLevel: number,
    cat: string,
    vendorIdx: number,
  ) =>
    prisma.ingredient.create({
      data: {
        organizationId: orgA.id,
        name,
        unit,
        costPerUnit,
        onHand,
        reorderLevel,
        categoryId: catsA.get(`ingredient:${cat}`),
        vendorId: vendorsA[vendorIdx].id,
      },
    })

  const beef = await ing('Beef Tenderloin', 'kg', 38.5, 12.5, 8, 'Meat & Poultry', 0)
  const oliveOil = await ing('Olive Oil (Extra Virgin)', 'l', 9.2, 4, 6, 'Oils & Fats', 1)
  const tomatoes = await ing('San Marzano Tomatoes', 'kg', 4.8, 22, 10, 'Produce', 1)
  const cream = await ing('Heavy Cream 33%', 'l', 3.6, 2.5, 5, 'Dairy', 2)
  const mushrooms = await ing('Button Mushrooms', 'kg', 6.4, 9, 4, 'Produce', 3)
  const flour = await ing('All-Purpose Flour', 'kg', 1.3, 40, 15, 'Dry Goods', 1)
  const butter = await ing('Unsalted Butter', 'kg', 9.5, 10, 4, 'Dairy', 2)
  const eggs = await ing('Eggs', 'ea', 0.35, 120, 48, 'Dairy', 2)

  await prisma.vendorProduct.createMany({
    data: [
      {
        organizationId: orgA.id,
        vendorId: vendorsA[2].id,
        ingredientId: butter.id,
        name: 'DD BUTTER UNSALTED 1LB',
        sku: 'DD-1147',
      },
      {
        organizationId: orgA.id,
        vendorId: vendorsA[2].id,
        ingredientId: cream.id,
        name: 'DD CREAM HEAVY 33% QT',
        sku: 'DD-2210',
      },
      {
        organizationId: orgA.id,
        vendorId: vendorsA[0].id,
        ingredientId: beef.id,
        name: 'PM TENDERLOIN PSMO',
        sku: 'PM-441',
      },
      {
        organizationId: orgA.id,
        vendorId: vendorsA[1].id,
        name: 'MED OLIO EXTRA VERGINE 5L',
        sku: 'MED-77',
      },
    ],
  })

  // One shared ingredient, bought on its own terms at one of the locations.
  await prisma.ingredientLocationSettings.create({
    data: {
      ingredientId: beef.id,
      locationId: airport.id,
      costPerUnit: 41.2,
      reorderLevel: 5,
      vendorId: vendorsA[1].id,
      vendorSku: 'AIR-BEEF-01',
    },
  })

  const stock = (ingredientId: string, parts: [string, number][]) =>
    prisma.ingredientLocationStock.createMany({
      data: parts.map(([locationId, onHand]) => ({ ingredientId, locationId, onHand })),
    })
  await stock(beef.id, [
    [downtown.id, 7.5],
    [riverside.id, 3],
    [airport.id, 2],
  ])
  await stock(oliveOil.id, [
    [downtown.id, 2],
    [riverside.id, 1.5],
    [airport.id, 0.5],
  ])
  await stock(tomatoes.id, [
    [downtown.id, 12],
    [riverside.id, 7],
    [airport.id, 3],
  ])
  await stock(cream.id, [
    [downtown.id, 1.5],
    [riverside.id, 1],
  ])
  await stock(mushrooms.id, [
    [downtown.id, 5],
    [riverside.id, 4],
  ])
  await stock(flour.id, [
    [downtown.id, 22],
    [riverside.id, 12],
    [airport.id, 6],
  ])
  await stock(butter.id, [
    [downtown.id, 6],
    [riverside.id, 4],
  ])
  await stock(eggs.id, [
    [downtown.id, 72],
    [riverside.id, 36],
    [airport.id, 12],
  ])

  const priceRow = (
    ingredientId: string,
    vendorIdx: number,
    costPerUnit: number,
    daysAgo: number,
    source: 'manual' | 'receipt',
  ) => ({
    organizationId: orgA.id,
    ingredientId,
    vendorId: vendorsA[vendorIdx].id,
    locationId: downtown.id,
    costPerUnit,
    source,
    recordedAt: new Date(Date.now() - daysAgo * 24 * 3600 * 1000),
  })
  await prisma.ingredientPriceHistory.createMany({
    data: [
      priceRow(beef.id, 0, 36.9, 45, 'receipt'),
      priceRow(beef.id, 0, 37.8, 20, 'receipt'),
      priceRow(beef.id, 0, 38.5, 5, 'receipt'),
      priceRow(oliveOil.id, 1, 8.7, 30, 'manual'),
      priceRow(oliveOil.id, 1, 9.2, 6, 'receipt'),
      priceRow(tomatoes.id, 1, 5.1, 28, 'receipt'),
      priceRow(tomatoes.id, 1, 4.8, 4, 'receipt'),
      priceRow(cream.id, 2, 3.4, 26, 'manual'),
      priceRow(cream.id, 2, 3.6, 3, 'receipt'),
    ],
  })

  const rec = async (
    name: string,
    cat: string,
    portions: number,
    locationId: string | null = null,
    yields: { yieldAmount: number; yieldUnit: string } | null = null,
  ) =>
    prisma.recipe.create({
      data: {
        organizationId: orgA.id,
        locationId,
        name,
        portions,
        categoryId: catsA.get(`recipe:${cat}`),
        targetFoodCostPct: 30,
        ...(yields ?? {}),
      },
    })

  const marinara = await rec('Marinara Sauce', 'Components', 12)
  const duxelles = await rec('Duxelles', 'Components', 8, null, { yieldAmount: 2.7, yieldUnit: 'kg' })
  const crepes = await rec('Crêpes', 'Components', 24, null, { yieldAmount: 24, yieldUnit: 'ea' })
  const wellington = await rec('Beef Wellington', 'Mains', 4)
  const steakFrites = await rec('Steak Frites', 'Mains', 2)
  const bruleee = await rec('Crème Brûlée', 'Desserts', 6)

  const ri = (recipeId: string, ingredientId: string, quantity: number, unit: string) =>
    prisma.recipeIngredient.create({ data: { recipeId, ingredientId, quantity, unit } })

  await ri(marinara.id, tomatoes.id, 6, 'kg')
  await ri(marinara.id, oliveOil.id, 0.5, 'l')
  await ri(duxelles.id, mushrooms.id, 2.4, 'kg')
  await ri(duxelles.id, butter.id, 0.3, 'kg')
  await ri(crepes.id, flour.id, 1, 'kg')
  await ri(crepes.id, eggs.id, 12, 'ea')
  await ri(crepes.id, cream.id, 1, 'l')
  await ri(wellington.id, beef.id, 0.8, 'kg')
  await ri(wellington.id, eggs.id, 1, 'ea')
  await ri(steakFrites.id, beef.id, 0.5, 'kg')
  await ri(bruleee.id, cream.id, 1, 'l')
  await ri(bruleee.id, eggs.id, 8, 'ea')

  await prisma.recipeComponent.createMany({
    data: [
      { parentId: wellington.id, componentId: duxelles.id, quantity: 0.3, unit: 'kg' },
      { parentId: wellington.id, componentId: crepes.id, quantity: 4, unit: 'ea' },
    ],
  })

  const mi = async (name: string, cat: string, price: number) =>
    prisma.menuItem.create({
      data: {
        organizationId: orgA.id,
        name,
        price,
        categoryId: catsA.get(`menu:${cat}`),
      },
    })
  const miSteak = await mi('Steak Frites', 'Mains', 34)
  const miWelly = await mi('Beef Wellington (for two)', 'Mains', 62)
  const miPasta = await mi('Pasta Marinara', 'Mains', 18)
  const miBrulee = await mi('Crème Brûlée', 'Desserts', 12)

  await prisma.menuItemRecipe.createMany({
    data: [
      { menuItemId: miSteak.id, recipeId: steakFrites.id, portions: 1 },
      { menuItemId: miWelly.id, recipeId: wellington.id, portions: 2 },
      { menuItemId: miPasta.id, recipeId: marinara.id, portions: 1 },
      { menuItemId: miBrulee.id, recipeId: bruleee.id, portions: 1 },
    ],
  })

  const day = (offset: number) => new Date(Date.now() - offset * 24 * 3600 * 1000)

  await prisma.inventoryTransaction.createMany({
    data: [
      {
        organizationId: orgA.id,
        locationId: downtown.id,
        ingredientId: beef.id,
        type: 'RECEIVE',
        quantity: 24,
        unit: 'kg',
        cost: 924,
        notes: 'Invoice #INV-2231 (Prime Meats)',
      },
      {
        organizationId: orgA.id,
        locationId: downtown.id,
        ingredientId: oliveOil.id,
        type: 'USE',
        quantity: -3.5,
        unit: 'l',
        cost: 32.2,
        notes: 'Prep — house dressing batch',
      },
      {
        organizationId: orgA.id,
        locationId: riverside.id,
        ingredientId: tomatoes.id,
        type: 'WASTE',
        quantity: -4.2,
        unit: 'kg',
        cost: 20.16,
        wasteReason: 'spoilage',
        notes: 'Spoilage — walk-in cooler',
      },
      {
        organizationId: orgA.id,
        locationId: downtown.id,
        ingredientId: cream.id,
        type: 'WASTE',
        quantity: -1.5,
        unit: 'l',
        cost: 5.4,
        wasteReason: 'expired',
        createdAt: day(1),
      },
      {
        organizationId: orgA.id,
        locationId: downtown.id,
        ingredientId: mushrooms.id,
        type: 'WASTE',
        quantity: -0.8,
        unit: 'kg',
        cost: 5.12,
        wasteReason: 'spoilage',
        createdAt: day(2),
      },
      {
        organizationId: orgA.id,
        locationId: riverside.id,
        ingredientId: beef.id,
        type: 'WASTE',
        quantity: -0.3,
        unit: 'kg',
        cost: 11.55,
        wasteReason: 'trim',
        createdAt: day(3),
      },
      {
        organizationId: orgA.id,
        locationId: downtown.id,
        ingredientId: cream.id,
        type: 'USE',
        quantity: -2,
        unit: 'l',
        cost: 7.2,
        notes: 'Crème brûlée batch',
      },
    ],
  })

  await prisma.wasteEntry.createMany({
    data: [
      {
        organizationId: orgA.id,
        locationId: riverside.id,
        ingredientId: tomatoes.id,
        quantity: 4.2,
        unit: 'kg',
        reason: 'spoilage',
        value: 20.16,
        date: new Date(),
        notes: 'Spoilage — walk-in cooler',
      },
      {
        organizationId: orgA.id,
        locationId: downtown.id,
        ingredientId: cream.id,
        quantity: 1.5,
        unit: 'l',
        reason: 'expired',
        value: 5.4,
        date: day(1),
      },
      {
        organizationId: orgA.id,
        locationId: downtown.id,
        ingredientId: mushrooms.id,
        quantity: 0.8,
        unit: 'kg',
        reason: 'spoilage',
        value: 5.12,
        date: day(2),
      },
      {
        organizationId: orgA.id,
        locationId: riverside.id,
        ingredientId: beef.id,
        quantity: 0.3,
        unit: 'kg',
        reason: 'trim',
        value: 11.55,
        date: day(3),
      },
    ],
  })

  await prisma.production.createMany({
    data: [
      {
        organizationId: orgA.id,
        locationId: downtown.id,
        recipeId: marinara.id,
        quantity: 12,
        unit: 'portion',
        cost: 33.4,
        madeBy: 'Ken Tanaka',
        date: day(1),
      },
      {
        organizationId: orgA.id,
        locationId: downtown.id,
        recipeId: duxelles.id,
        quantity: 4,
        unit: 'portion',
        cost: 9.11,
        madeBy: 'Ken Tanaka',
        date: day(2),
      },
    ],
  })

  await recalcOrganizationWith(prisma as never, orgA.id)
  const unitCostOf = async (menuItemId: string) => {
    const links = await prisma.menuItemRecipe.findMany({
      where: { menuItemId },
      include: { recipe: { select: { totalCost: true, portions: true } } },
    })
    return links.reduce(
      (sum, l) =>
        sum + (Number(l.recipe.totalCost) / Math.max(1, l.recipe.portions)) * Number(l.portions),
      0,
    )
  }
  const costSteak = await unitCostOf(miSteak.id)
  const costPasta = await unitCostOf(miPasta.id)
  const costWelly = await unitCostOf(miWelly.id)
  const costBrulee = await unitCostOf(miBrulee.id)

  const SALES_DAYS = 30
  const WEEKDAY_PROFILE = [0.95, 0.78, 0.84, 0.92, 1.05, 1.28, 1.34]
  const portions = (base: number, factor: number) => Math.max(1, Math.round(base * factor))

  for (let d = 0; d < SALES_DAYS; d++) {
    const date = day(d)
    const factor = (1 - d * 0.008) * WEEKDAY_PROFILE[date.getDay()]

    for (const [locationId, share] of [
      [downtown.id, 1],
      [riverside.id, 0.55],
    ] as const) {
      const sale = await prisma.sale.create({
        data: { organizationId: orgA.id, locationId, date },
      })
      await prisma.saleItem.createMany({
        data: [
          {
            saleId: sale.id,
            menuItemId: miSteak.id,
            quantity: portions(11 * share, factor),
            unitPrice: 34,
            unitCost: costSteak,
          },
          {
            saleId: sale.id,
            menuItemId: miPasta.id,
            quantity: portions(15 * share, factor),
            unitPrice: 18,
            unitCost: costPasta,
          },
          {
            saleId: sale.id,
            menuItemId: miWelly.id,
            quantity: portions(3 * share, factor),
            unitPrice: 62,
            unitCost: costWelly,
          },
          {
            saleId: sale.id,
            menuItemId: miBrulee.id,
            quantity: portions(7 * share, factor),
            unitPrice: 12,
            unitCost: costBrulee,
          },
        ],
      })
    }
  }

  await prisma.invoice.create({
    data: {
      organizationId: orgA.id,
      locationId: downtown.id,
      vendorId: vendorsA[0].id,
      number: 'INV-2231',
      invoiceDate: day(0),
      status: 'confirmed',
      subtotal: 924,
      tax: 0,
      total: 924,
      items: {
        create: [
          {
            ingredientId: beef.id,
            description: 'Beef Tenderloin',
            quantity: 24,
            unit: 'kg',
            unitPrice: 38.5,
            lineTotal: 924,
          },
        ],
      },
    },
  })

  const invoiceLines = [
    { ingredientId: tomatoes.id, description: 'San Marzano Tomatoes', quantity: 20, unit: 'kg', unitPrice: 4.8 },
    { ingredientId: oliveOil.id, description: 'Olive Oil (Extra Virgin)', quantity: 6, unit: 'l', unitPrice: 9.2 },
  ]
  const invoiceSubtotal = invoiceLines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0)
  await prisma.invoice.create({
    data: {
      organizationId: orgA.id,
      locationId: downtown.id,
      vendorId: vendorsA[1].id,
      number: 'MI-2026-0714',
      invoiceDate: day(3),
      status: 'confirmed',
      subtotal: invoiceSubtotal,
      tax: 0,
      total: invoiceSubtotal,
      items: {
        create: invoiceLines.map((l) => ({ ...l, lineTotal: l.quantity * l.unitPrice })),
      },
    },
  })

  console.log('— Org B: Bella Cucina LLC…')
  const orgB = await prisma.organization.create({
    data: {
      name: 'Bella Cucina LLC',
      slug: 'bella-cucina',
      ownerName: 'Sofia Ricci',
      ownerEmail: 'owner@bellacucina.com',
      subscriptionStatus: 'trial',
      trialEndsAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
    },
  })
  const mainB = await prisma.location.create({
    data: { organizationId: orgB.id, name: 'Bella Cucina — Main', isDefault: true },
  })
  await prisma.user.create({
    data: {
      organizationId: orgB.id,
      email: 'owner@bellacucina.com',
      hashedPassword: hashed,
      fullName: 'Sofia Ricci',
      role: 'owner',
      emailVerified: true,
    },
  })
  await prisma.user.create({
    data: {
      organizationId: orgB.id,
      email: 'platform@nexus.app',
      hashedPassword: hashed,
      fullName: 'Nexus Platform Admin',
      role: 'admin',
      isPlatformAdmin: true,
      emailVerified: true,
    },
  })

  const vendorB = await prisma.vendor.create({
    data: { organizationId: orgB.id, name: 'Prime Meats Co.', contact: 'bella@primemeats.com' },
  })
  const beefB = await prisma.ingredient.create({
    data: {
      organizationId: orgB.id,
      name: 'Beef Tenderloin',
      unit: 'kg',
      costPerUnit: 36.0,
      onHand: 5,
      reorderLevel: 3,
      vendorId: vendorB.id,
    },
  })
  await prisma.vendorProduct.create({
    data: {
      organizationId: orgB.id,
      vendorId: vendorB.id,
      ingredientId: beefB.id,
      name: 'PM TENDERLOIN PSMO',
      sku: 'PM-441',
    },
  })

  const recB = await prisma.recipe.create({
    data: { organizationId: orgB.id, name: 'Marinara Sauce', portions: 10 },
  })
  await prisma.recipeIngredient.create({
    data: { recipeId: recB.id, ingredientId: beefB.id, quantity: 0.2, unit: 'kg' },
  })
  const miPastaB = await prisma.menuItem.create({
    data: { organizationId: orgB.id, locationId: mainB.id, name: 'Pasta Marinara', price: 15 },
  })
  await prisma.menu.create({
    data: {
      organizationId: orgB.id,
      name: 'All Day',
      locations: { create: [{ locationId: mainB.id }] },
      items: { create: [{ menuItemId: miPastaB.id, sortOrder: 0 }] },
    },
  })

  await prisma.menu.create({
    data: {
      organizationId: orgA.id,
      name: 'Dinner',
      description: 'Evening service across the group',
      locations: { create: [{ locationId: downtown.id }, { locationId: riverside.id }] },
      items: {
        create: [
          { menuItemId: miSteak.id, sortOrder: 0 },
          { menuItemId: miWelly.id, sortOrder: 1 },
          { menuItemId: miPasta.id, sortOrder: 2 },
          { menuItemId: miBrulee.id, sortOrder: 3 },
        ],
      },
    },
  })
  await prisma.menu.create({
    data: {
      organizationId: orgA.id,
      name: 'Lunch',
      locations: { create: [{ locationId: downtown.id }] },
      items: { create: [{ menuItemId: miPasta.id, sortOrder: 0 }] },
    },
  })

  const changedA = await recalcOrganizationWith(prisma as never, orgA.id)
  const changedB = await recalcOrganizationWith(prisma as never, orgB.id)
  console.log(`✓ Costing: recipes recalculated A=${changedA}, B=${changedB}`)

  const counts = {
    organizations: await prisma.organization.count(),
    locations: await prisma.location.count(),
    users: await prisma.user.count(),
    vendors: await prisma.vendor.count(),
    ingredients: await prisma.ingredient.count(),
    recipes: await prisma.recipe.count(),
    menuItems: await prisma.menuItem.count(),
    menus: await prisma.menu.count(),
    vendorProducts: await prisma.vendorProduct.count(),
    sales: await prisma.sale.count(),
    invoices: await prisma.invoice.count(),
  }
  console.log('✓ Seeded:', counts)
  console.log(
    `  Logins (password ${PASSWORD}): owner@goldenfork.com · maria@goldenfork.com · ken@goldenfork.com · owner@bellacucina.com · platform@nexus.app (platform administrator)`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
