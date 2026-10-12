import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = join(__dirname, '..')
const TIMESTAMP =
  /orderBy: \{ (date|createdAt|updatedAt|recordedAt|invoiceDate|acceptedAt|occurredAt): '(asc|desc)' \}/

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === 'generated') return []
    if (statSync(path).isDirectory()) return sources(path)
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : []
  })
}

describe('rows that share an instant come back in one order', () => {
  test('no read orders by a moment alone', () => {
    const alone = sources(SOURCE).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line, i) =>
          TIMESTAMP.test(line) ? `${path.slice(SOURCE.length + 1)}:${i + 1}` : null,
        )
        .filter((hit): hit is string => hit !== null),
    )
    expect(alone).toEqual([])
  })
})
