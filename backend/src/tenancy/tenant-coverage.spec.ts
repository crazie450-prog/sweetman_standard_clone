import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHILD_MODELS, LOCATION_STRICT, TENANT_MODELS, TENANT_ROOT } from './tenant.extension'

interface SchemaModel {
  name: string
  fields: string[]
}

function readModels(): SchemaModel[] {
  const schema = readFileSync(join(__dirname, '..', '..', 'prisma', 'schema.prisma'), 'utf8')
  const models: SchemaModel[] = []
  let current: SchemaModel | null = null

  for (const line of schema.split('\n')) {
    const opening = /^model\s+(\w+)\s*\{/.exec(line)
    if (opening) {
      current = { name: opening[1], fields: [] }
      continue
    }
    if (!current) continue
    if (/^\}/.test(line)) {
      models.push(current)
      current = null
      continue
    }
    const field = /^\s+(\w+)\s+\S/.exec(line)
    if (field) current.fields.push(field[1])
  }
  return models
}

const MODELS = readModels()
const named = (name: string) => MODELS.find((m) => m.name === name)
const carries = (model: SchemaModel, field: string) => model.fields.includes(field)

describe('the schema and the isolation lists describe the same world', () => {
  test('the schema parses into models with fields', () => {
    expect(MODELS.length).toBeGreaterThan(20)
    expect(named('Sale')?.fields).toContain('organizationId')
  })

  test('every model the schema defines is classified exactly once', () => {
    for (const model of MODELS) {
      const places = [
        TENANT_MODELS.has(model.name),
        CHILD_MODELS.has(model.name),
        model.name === TENANT_ROOT,
      ].filter(Boolean).length
      expect([model.name, places]).toEqual([model.name, 1])
    }
  })

  test('a model that carries organizationId is scoped by the extension', () => {
    for (const model of MODELS) {
      if (!carries(model, 'organizationId')) continue
      expect([model.name, TENANT_MODELS.has(model.name)]).toEqual([model.name, true])
    }
  })

  test('a model listed as tenant-scoped really carries organizationId', () => {
    for (const name of TENANT_MODELS) {
      const model = named(name)
      expect([name, model !== undefined]).toEqual([name, true])
      expect([name, carries(model!, 'organizationId')]).toEqual([name, true])
    }
  })

  test('a child model carries no organizationId and reaches a scoped parent', () => {
    for (const [name, parent] of CHILD_MODELS) {
      const model = named(name)
      expect([name, model !== undefined]).toEqual([name, true])
      expect([name, carries(model!, 'organizationId')]).toEqual([name, false])
      expect([name, carries(model!, parent)]).toEqual([name, true])
    }
  })

  test('every location-strict model has a locationId to be strict about', () => {
    for (const name of LOCATION_STRICT) {
      const model = named(name)
      expect([name, model !== undefined]).toEqual([name, true])
      expect([name, carries(model!, 'locationId')]).toEqual([name, true])
    }
  })
})
