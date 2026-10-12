import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { StorageService } from '../src/storage/storage.service'
import { configWith } from './config'

const endpoint = process.env.S3_TEST_ENDPOINT

;(endpoint ? describe : describe.skip)('Storage on an S3-compatible store (e2e)', () => {
  const bucket = `nexus-e2e-${Date.now()}`
  const saved = { ...process.env }
  let storage: StorageService

  beforeAll(async () => {
    Object.assign(process.env, {
      AWS_ACCESS_KEY_ID: process.env.S3_TEST_ACCESS_KEY ?? 'nexus',
      AWS_SECRET_ACCESS_KEY: process.env.S3_TEST_SECRET_KEY ?? 'nexus_dev_s3',
    })
    await new S3Client({ region: 'us-east-1', endpoint, forcePathStyle: true }).send(
      new CreateBucketCommand({ Bucket: bucket }),
    )
    storage = new StorageService(
      configWith({
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: bucket,
        S3_ENDPOINT: endpoint,
        S3_FORCE_PATH_STYLE: 'true',
        AWS_REGION: 'us-east-1',
      }),
    )
  })

  afterAll(() => {
    process.env = saved
  })

  it('writes, reads, signs and removes a document in the bucket rather than on disk', async () => {
    expect(storage.driver).toBe('s3')
    const key = 'org-1/invoices/probe.csv'
    const body = Buffer.from('Item,Quantity\nButter,4\n')

    await expect(storage.put(key, body, 'text/csv')).resolves.toEqual({ key, size: body.length })
    await expect(storage.get(key)).resolves.toEqual(body)

    const url = await storage.signedUrl(key, 60)
    expect(url.startsWith(`${endpoint}/${bucket}/${key}?`)).toBe(true)
    const fetched = await fetch(url)
    expect(fetched.status).toBe(200)
    expect(Buffer.from(await fetched.arrayBuffer())).toEqual(body)

    await storage.remove(key)
    await expect(storage.get(key)).rejects.toThrow()
  })

  it('refuses a key that climbs out of the store before anything is sent', async () => {
    await expect(storage.put('../escape.txt', Buffer.from('x'))).rejects.toThrow(
      'Invalid storage key',
    )
  })
})
