import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { safeStorageKey, StorageService } from './storage.service'
import { configWith } from '../../test/config'

jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }))

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

describe('StorageService on S3', () => {
  test('a bucket that does not answer is given up on, not waited for', async () => {
    const s3 = new StorageService(
      configWith({
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'probe-bucket',
        S3_ENDPOINT: 'http://127.0.0.1:9',
      }),
    )['s3']
    const handler = s3?.config.requestHandler as unknown as {
      configProvider: Promise<{
        connectionTimeout?: number
        requestTimeout?: number
        throwOnRequestTimeout?: boolean
      }>
    }
    const config = await handler.configProvider
    expect(config.connectionTimeout).toBeGreaterThan(0)
    expect(config.requestTimeout).toBeGreaterThan(0)
    expect(config.throwOnRequestTimeout).toBe(true)
  })

  const onS3 = () =>
    new StorageService(
      configWith({
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'probe-bucket',
        S3_ENDPOINT: 'http://127.0.0.1:9',
      }),
    )

  test('says it stores on S3', () => {
    expect(onS3().driver).toBe('s3')
  })

  test('puts, reads and removes a file in its bucket under the safe key', async () => {
    const sent: unknown[] = []
    const send = jest.spyOn(S3Client.prototype, 'send').mockImplementation(((command: unknown) => {
      sent.push(command)
      return Promise.resolve(
        command instanceof GetObjectCommand
          ? { Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([104, 105])) } }
          : {},
      )
    }) as never)
    try {
      const storage = onS3()
      expect(await storage.put('org-1/./a.pdf', Buffer.from('hi'), 'application/pdf')).toEqual({
        key: 'org-1/a.pdf',
        size: 2,
      })
      expect((await storage.get('org-1/a.pdf')).toString()).toBe('hi')
      await storage.remove('org-1/a.pdf')

      const [put, get, remove] = sent as [PutObjectCommand, GetObjectCommand, DeleteObjectCommand]
      expect(put).toBeInstanceOf(PutObjectCommand)
      expect(put.input).toMatchObject({
        Bucket: 'probe-bucket',
        Key: 'org-1/a.pdf',
        ContentType: 'application/pdf',
      })
      expect(get.input).toEqual({ Bucket: 'probe-bucket', Key: 'org-1/a.pdf' })
      expect(remove).toBeInstanceOf(DeleteObjectCommand)
      expect(remove.input).toEqual({ Bucket: 'probe-bucket', Key: 'org-1/a.pdf' })
    } finally {
      send.mockRestore()
    }
  })

  test('refuses a key that climbs out before anything is sent', async () => {
    const send = jest.spyOn(S3Client.prototype, 'send')
    try {
      await expect(onS3().get('../secret')).rejects.toThrow()
      expect(send).not.toHaveBeenCalled()
    } finally {
      send.mockRestore()
    }
  })

  test('signs a link to the file for the time it is asked for', async () => {
    const signed = getSignedUrl as jest.Mock
    signed.mockResolvedValue('https://probe-bucket/org-1/a.pdf?signed')
    expect(await onS3().signedUrl('org-1/a.pdf', 60)).toBe(
      'https://probe-bucket/org-1/a.pdf?signed',
    )
    const [, command, options] = signed.mock.calls[0] as [unknown, GetObjectCommand, object]
    expect(command.input).toEqual({ Bucket: 'probe-bucket', Key: 'org-1/a.pdf' })
    expect(options).toEqual({ expiresIn: 60 })
  })
})

describe('StorageService on the local disk', () => {
  test('stores locally without a bucket and links to the file on disk', async () => {
    const storage = new StorageService(
      configWith({
        STORAGE_PROVIDER: undefined,
        S3_BUCKET: undefined,
        STORAGE_LOCAL_DIR: '/tmp/nexus-probe',
      }),
    )
    expect(storage.driver).toBe('local')
    expect(await storage.signedUrl('org-1/a.pdf')).toBe('file:///tmp/nexus-probe/org-1/a.pdf')
  })
})
