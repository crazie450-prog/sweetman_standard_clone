import * as fs from 'node:fs'
import * as path from 'node:path'

// Every rule names the writes it guards and every method allowed to make them, with the
// function that method must call. A new method writing those rows fails the first test until
// it is listed here, and a listed method that stops calling its rule fails the second.

type Site = { at: string; calls: string[]; via?: true } | { at: string; exempt: string }

interface Rule {
  name: string
  writes: RegExp[]
  sites: Site[]
}

const RULES: Rule[] = [
  {
    name: 'a nested recipe is measured in what it yields',
    writes: [
      /(?:tx|client|db)\.recipeComponent\.(create|createMany|createManyAndReturn|update|updateMany|upsert)\(/,
      /components:\s*\{\s*create/,
    ],
    sites: [
      { at: 'modules/recipes/recipes.service.ts#addComponent', calls: ['assertComponentUnit'] },
      { at: 'modules/recipes/recipes.service.ts#updateComponent', calls: ['assertComponentUnit'] },
      { at: 'modules/documents/documents.service.ts#applyRecipe', calls: ['planRecipe'] },
      {
        at: 'modules/documents/documents.service.ts#planRecipe',
        calls: ['componentMeasure'],
        via: true,
      },
      {
        at: 'modules/recipes/recipes.service.ts#assertComponentUnit',
        calls: ['componentMeasure'],
        via: true,
      },
    ],
  },
  {
    name: 'what a recipe is measured through stays while it is used',
    writes: [
      /(?:tx|client|db)\.unitConversion\.(update|updateMany|delete|deleteMany)\(/,
      /(?:tx|client|db)\.recipe\.(update|updateMany)\(/,
    ],
    sites: [
      { at: 'modules/units/units.service.ts#update', calls: ['assertLinesStillReached'] },
      { at: 'modules/units/units.service.ts#remove', calls: ['assertLinesStillReached'] },
      {
        at: 'modules/recipes/recipes.service.ts#update',
        calls: ['assertYieldStillMeasured', 'assertMovable'],
      },
      {
        at: 'costing/costing.service.ts#recalcWithin',
        exempt: 'writes the cost it computed and nothing a rule reads',
      },
    ],
  },
  {
    name: 'a recipe line is costed in a unit that reaches its ingredient',
    writes: [
      /(?:tx|client|db)\.recipeIngredient\.(create|createMany|createManyAndReturn|update|updateMany|upsert)\(/,
      /ingredients:[\s\S]{0,80}?\{\s*create/,
    ],
    sites: [
      { at: 'modules/recipes/recipes.service.ts#create', calls: ['assertLineUnits'] },
      { at: 'modules/recipes/recipes.service.ts#update', calls: ['assertLineUnits'] },
      { at: 'modules/documents/documents.service.ts#applyRecipe', calls: ['planRecipe'] },
      {
        at: 'modules/documents/documents.service.ts#planRecipe',
        calls: ['isConvertible'],
        via: true,
      },
      {
        at: 'modules/ingredients/ingredients.service.ts#rebase',
        exempt: "gives a line the ingredient's own new unit",
      },
    ],
  },
  {
    name: 'an archived location takes nothing new',
    writes: [
      /(?:tx|client|db)\.(recipe|menuItem)\.(create|update)\(/,
      /(?:tx|client|db)\.userLocation\.(create|createMany|createManyAndReturn)\(/,
      /(?:tx|client|db)\.menuOnLocation\.(create|createMany|createManyAndReturn)\(/,
      /locations:[\s\S]{0,80}?\{\s*create/,
      /(?:tx|client|db)\.invitation\.create\(/,
    ],
    sites: [
      { at: 'modules/recipes/recipes.service.ts#create', calls: ['assertLocationsActive'] },
      { at: 'modules/recipes/recipes.service.ts#update', calls: ['assertLocationsActive'] },
      { at: 'modules/menu/menu.service.ts#create', calls: ['assertLocationsActive'] },
      { at: 'modules/menu/menu.service.ts#update', calls: ['assertLocationsActive'] },
      { at: 'modules/menu/menus.service.ts#create', calls: ['assertLocationsActive'] },
      { at: 'modules/menu/menus.service.ts#update', calls: ['assertLocationsActive'] },
      { at: 'modules/team/team.service.ts#update', calls: ['assertLocationsActive'] },
      { at: 'invitations/invitations.service.ts#create', calls: ['assertLocationsActive'] },
      { at: 'invitations/invitations.service.ts#accept', calls: ['isActive: true'] },
      {
        at: 'modules/documents/documents.service.ts#applyRecipe',
        exempt: 'reached only through confirm',
      },
      {
        at: 'modules/documents/documents.service.ts#applyMenu',
        exempt: 'reached only through confirm',
      },
      {
        at: 'modules/documents/documents.service.ts#confirm',
        calls: ['assertLocationOpen'],
        via: true,
      },
      {
        at: 'costing/costing.service.ts#recalcWithin',
        exempt: 'writes the cost it computed, never a location',
      },
    ],
  },
  {
    name: 'a name is claimed once where it is used',
    writes: [
      /(?:tx|client|db)\.(recipe|menuItem|menu|category|vendorProduct|menuItemAlias|vendor|ingredient|location)\.(create|createMany|createManyAndReturn|upsert)\(/,
    ],
    sites: [
      { at: 'modules/recipes/recipes.service.ts#create', calls: ['assertNameFree'] },
      { at: 'modules/recipes/recipes.service.ts#update', calls: ['assertNameFree'], via: true },
      { at: 'modules/menu/menu.service.ts#create', calls: ['assertNameFree'] },
      { at: 'modules/menu/menu.service.ts#update', calls: ['assertNameFree'], via: true },
      { at: 'modules/menu/menus.service.ts#create', calls: ['assertNameFree'] },
      { at: 'modules/menu/menus.service.ts#update', calls: ['assertNameFree'], via: true },
      { at: 'modules/categories/categories.service.ts#create', calls: ['assertNameFree'] },
      {
        at: 'modules/categories/categories.service.ts#rename',
        calls: ['assertNameFree'],
        via: true,
      },
      { at: 'modules/vendors/vendor-products.service.ts#create', calls: ['assertNameFree'] },
      {
        at: 'modules/vendors/vendor-products.service.ts#update',
        calls: ['assertNameFree'],
        via: true,
      },
      { at: 'modules/documents/documents.service.ts#applyRecipe', calls: ['sameKitchen'] },
      { at: 'modules/documents/documents.service.ts#saveFileUnits', calls: ['sameName'] },
      { at: 'modules/documents/documents.service.ts#applyInvoice', calls: ['sameName'] },
      {
        at: 'modules/documents/documents.service.ts#applyMenu',
        calls: ['sameName', 'sameKitchen'],
      },
      { at: 'modules/documents/names.ts#parkIngredients', calls: ['anyOf'] },
      { at: 'modules/documents/documents.service.ts#bindOn', calls: ['sameName'] },
      {
        at: 'modules/documents/documents.service.ts#createMenuAlias',
        calls: ['assertMenuNameFree'],
      },
      { at: 'modules/documents/names.ts#parkDishes', calls: ['anyOf'] },
      { at: 'modules/vendors/vendors.service.ts#create', calls: ['assertNameFree'] },
      { at: 'modules/vendors/vendors.service.ts#update', calls: ['assertNameFree'], via: true },
      { at: 'modules/ingredients/ingredients.service.ts#create', calls: ['assertNameFree'] },
      {
        at: 'modules/ingredients/ingredients.service.ts#update',
        calls: ['assertNameFree'],
        via: true,
      },
      { at: 'modules/locations/locations.service.ts#create', calls: ['assertNameFree'] },
      { at: 'modules/locations/locations.service.ts#update', calls: ['assertNameFree'], via: true },
      {
        at: 'auth/auth.service.ts#register',
        exempt: 'the first location of a new organization has no other to clash with',
      },
    ],
  },
  {
    name: 'a category files only the kind of record it is for',
    writes: [
      /(?:tx|client|db)\.(recipe|menuItem|ingredient)\.(create|createManyAndReturn|update)\(/,
    ],
    sites: [
      { at: 'modules/recipes/recipes.service.ts#create', calls: ['assertCategoryKind'] },
      { at: 'modules/recipes/recipes.service.ts#update', calls: ['assertCategoryKind'] },
      { at: 'modules/menu/menu.service.ts#create', calls: ['assertCategoryKind'] },
      { at: 'modules/menu/menu.service.ts#update', calls: ['assertCategoryKind'] },
      { at: 'modules/ingredients/ingredients.service.ts#create', calls: ['assertRefs'] },
      { at: 'modules/ingredients/ingredients.service.ts#update', calls: ['assertRefs'] },
      {
        at: 'modules/ingredients/ingredients.service.ts#assertRefs',
        calls: ['assertCategoryKind'],
        via: true,
      },
      {
        at: 'modules/ingredients/ingredients.service.ts#openHere',
        exempt: 'records the opening stock, never a category',
      },
      {
        at: 'modules/ingredients/ingredients.service.ts#rebase',
        exempt: 'changes the unit, never a category',
      },
      { at: 'modules/documents/documents.service.ts#applyMenu', calls: ["kind: 'menu'"] },
      { at: 'modules/documents/documents.service.ts#applyRecipe', exempt: 'files no category' },
      { at: 'modules/documents/documents.service.ts#saveFileUnits', exempt: 'files no category' },
      { at: 'modules/documents/documents.service.ts#applyInvoice', exempt: 'files no category' },
      {
        at: 'modules/documents/delivery.ts#write',
        exempt: 'moves stock and a price, never a category',
      },
      {
        at: 'modules/inventory/inventory.service.ts#createTransaction',
        exempt: 'moves stock, never a category',
      },
      { at: 'rules/stock.ts#takeFromStock', exempt: 'moves stock, never a category' },
      {
        at: 'costing/costing.service.ts#recalcWithin',
        exempt: 'writes the cost it computed, never a category',
      },
    ],
  },
  {
    name: 'a kitchen builds on and cooks only recipes it has',
    writes: [
      /(?:tx|client|db)\.production\.create\(/,
      /(?:tx|client|db)\.recipeComponent\.(create|createMany|createManyAndReturn|upsert)\(/,
      /components:\s*\{\s*create/,
      /(?:tx|client|db)\.menuItemRecipe\.(create|createMany|createManyAndReturn)\(/,
      /recipes:[\s\S]{0,80}?\{\s*create/,
    ],
    sites: [
      { at: 'modules/production/production.service.ts#create', calls: ['assertBuiltHere'] },
      { at: 'modules/recipes/recipes.service.ts#addComponent', calls: ['assertBuiltHere'] },
      { at: 'modules/menu/menu.service.ts#create', calls: ['assertRecipesFit'] },
      { at: 'modules/menu/menu.service.ts#update', calls: ['assertRecipesFit'] },
      {
        at: 'modules/menu/menu.service.ts#assertRecipesFit',
        calls: ['assertBuiltHere'],
        via: true,
      },
      { at: 'modules/documents/documents.service.ts#applyRecipe', calls: ['planRecipe'] },
      {
        at: 'modules/documents/documents.service.ts#planRecipe',
        calls: ['nestedRecipes'],
        via: true,
      },
      {
        at: 'modules/documents/documents.service.ts#nestedRecipes',
        calls: ['sameKitchen'],
        via: true,
      },
    ],
  },
  {
    name: 'stock is drawn through one door',
    writes: [/onHand:\s*\{\s*decrement/],
    sites: [{ at: 'rules/stock.ts#takeFromStock', calls: ['onHand: { gte: taken }'] }],
  },
  {
    name: 'a sales name parked at a location is curated by those who work there',
    writes: [/(?:tx|client|db)\.menuItemAlias\.(update|updateMany|delete|deleteMany)\(/],
    sites: [
      { at: 'modules/documents/documents.service.ts#mapMenuAlias', calls: ['worksAt'] },
      { at: 'modules/documents/documents.service.ts#removeMenuAlias', calls: ['worksAt'] },
    ],
  },
]

/* ===== Reading the source ===== */

const ROOT = path.resolve(__dirname, '..')

function sources(dir = ROOT): string[] {
  return fs.readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (fs.statSync(full).isDirectory()) return entry === 'generated' ? [] : sources(full)
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : []
  })
}

const HEADER =
  /^ {2}(?:(?:private|protected|public|static|async) )*([a-zA-Z]\w*)\s*[(<]|^(?:export )?(?:async )?function (\w+)/
const NOT_A_METHOD = new Set([
  'if',
  'for',
  'while',
  'switch',
  'return',
  'await',
  'catch',
  'constructor',
])

interface Method {
  at: string
  body: string
}

function methods(): Method[] {
  return sources().flatMap((file) => {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    const found: { name: string; from: number }[] = []
    lines.forEach((line, i) => {
      const match = HEADER.exec(line)
      const name = match?.[1] ?? match?.[2]
      if (name && !NOT_A_METHOD.has(name)) found.push({ name, from: i })
    })
    const relative = path.relative(ROOT, file)
    return found.map((m, k) => ({
      at: `${relative}#${m.name}`,
      body: lines.slice(m.from, found[k + 1]?.from ?? lines.length).join('\n'),
    }))
  })
}

const ALL = methods()
const writing = (rule: Rule, method: Method) => rule.writes.some((w) => w.test(method.body))

/* ===== The registry against the source ===== */

describe('every write a rule guards keeps that rule', () => {
  describe.each(RULES.map((rule) => [rule.name, rule] as const))('%s', (_name, rule) => {
    test('every method making such a write is listed', () => {
      const listed = new Set(rule.sites.map((s) => s.at))
      const unlisted = ALL.filter((m) => writing(rule, m) && !listed.has(m.at)).map((m) => m.at)
      expect([...new Set(unlisted)]).toEqual([])
    })

    test('every listed method calls the rule', () => {
      const broken = rule.sites.flatMap((site) => {
        if ('exempt' in site) return []
        const bodies = ALL.filter((m) => m.at === site.at)
        if (bodies.length === 0) return [`${site.at} no longer exists`]
        if (site.via) {
          return bodies.some((m) => site.calls.every((call) => m.body.includes(call)))
            ? []
            : [`${site.at} does not call ${site.calls.join(', ')}`]
        }
        const checked = bodies.filter((m) => writing(rule, m))
        if (checked.length === 0) return [`${site.at} no longer makes the write it is listed for`]
        return checked.flatMap((m) =>
          site.calls
            .filter((call) => !m.body.includes(call))
            .map((call) => `${site.at} does not call ${call}`),
        )
      })
      expect(broken).toEqual([])
    })
  })
})
