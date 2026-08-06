import { safeStorageKey } from './storage.service'

describe('safeStorageKey', () => {
  test('keeps an ordinary key untouched', () => {
    expect(safeStorageKey('org-1/invoices/2026-07/receipt.pdf')).toBe(
      'org-1/invoices/2026-07/receipt.pdf',
    )
  })

  test('collapses redundant segments without leaving the root', () => {
    expect(safeStorageKey('org-1/drafts/../invoices/receipt.pdf')).toBe(
      'org-1/invoices/receipt.pdf',
    )
    expect(safeStorageKey('./org-1/receipt.pdf')).toBe('org-1/receipt.pdf')
  })

  test('allows dots inside a file name', () => {
    expect(safeStorageKey('org-1/..hidden.pdf')).toBe('org-1/..hidden.pdf')
    expect(safeStorageKey('org-1/report..2026.pdf')).toBe('org-1/report..2026.pdf')
  })

  test('rejects a key that climbs above the storage root', () => {
    expect(() => safeStorageKey('../../etc/passwd')).toThrow()
    expect(() => safeStorageKey('org-1/../../etc/passwd')).toThrow()
    expect(() => safeStorageKey('..')).toThrow()
  })

  test('rejects an absolute path', () => {
    expect(() => safeStorageKey('/etc/passwd')).toThrow()
  })

  test('rejects an empty key or one carrying a null byte', () => {
    expect(() => safeStorageKey('   ')).toThrow()
    expect(() => safeStorageKey('org-1/receipt.pdf\0.png')).toThrow()
  })
})
