import { BadRequestException, Injectable, Logger, Module } from '@nestjs/common'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'

export interface StoredFile {
  key: string
  size: number
}

export function safeStorageKey(key: string): string {
  const trimmed = key.trim()
  const invalid = new BadRequestException('Invalid storage key')
  if (!trimmed || trimmed.includes('\0') || isAbsolute(trimmed)) throw invalid
  const normalized = normalize(trimmed)
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw invalid
  }
  return normalized
}

@Injectable()
export class StorageService {
  private readonly log = new Logger('Storage')
  private readonly bucket = process.env.S3_BUCKET
  private readonly localRoot = resolve(process.env.STORAGE_LOCAL_DIR ?? './.storage')
  private readonly s3 = this.bucket
    ? new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' })
    : null

  get driver(): 's3' | 'local' {
    return this.s3 ? 's3' : 'local'
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<StoredFile> {
    const safe = safeStorageKey(key)
    if (this.s3 && this.bucket) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: safe,
          Body: body,
          ContentType: contentType,
        }),
      )
    } else {
      const path = join(this.localRoot, safe)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
      this.log.debug(`local put ${safe} (${body.length} B)`)
    }
    return { key: safe, size: body.length }
  }

  async get(key: string): Promise<Buffer> {
    const safe = safeStorageKey(key)
    if (this.s3 && this.bucket) {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: safe }))
      return Buffer.from(await res.Body!.transformToByteArray())
    }
    return readFile(join(this.localRoot, safe))
  }

  async signedUrl(key: string, ttlSeconds = 900): Promise<string> {
    const safe = safeStorageKey(key)
    if (this.s3 && this.bucket) {
      return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: safe }), {
        expiresIn: ttlSeconds,
      })
    }
    return `file://${join(this.localRoot, safe)}`
  }
}

@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
