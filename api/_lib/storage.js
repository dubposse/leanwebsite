import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

// Private Cloudflare R2 storage (S3-compatible). Server-side only: no public URLs are ever created.

export const MAX_OBJECT_SIZE_BYTES = 50 * 1024 * 1024

export const ALLOWED_CONTENT_TYPES = Object.freeze([
  'application/zip',
  'application/json',
  'application/octet-stream',
  'text/html',
  'text/css',
  'text/javascript',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'image/gif',
  'audio/mpeg',
  'video/mp4',
])

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/i
const KEY_PATTERN =
  /^(?:drafts\/[0-9a-f-]{36}\/[a-z0-9][a-z0-9._-]{0,99}|orders\/[0-9a-f-]{36}\/(?:website\.zip|snapshot))$/i

const ENV_NAMES = {
  accountId: 'R2_ACCOUNT_ID',
  accessKeyId: 'R2_ACCESS_KEY_ID',
  secretAccessKey: 'R2_SECRET_ACCESS_KEY',
  bucketName: 'R2_BUCKET_NAME',
}

let cached

export function getR2Config(env = process.env) {
  const config = {}
  const missing = []

  for (const [field, name] of Object.entries(ENV_NAMES)) {
    const value = env[name]?.trim()

    if (value) {
      config[field] = value
    } else {
      missing.push(name)
    }
  }

  if (missing.length > 0) {
    throw new Error(`R2 storage is not configured. Missing environment variables: ${missing.join(', ')}`)
  }

  if (!/^[a-f0-9]{32}$/i.test(config.accountId)) {
    throw new Error('R2_ACCOUNT_ID has an unexpected format (expected 32 hex characters)')
  }

  return { ...config, endpoint: `https://${config.accountId}.r2.cloudflarestorage.com` }
}

export function createStorageClient(config) {
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // R2 does not support the optional checksum headers newer SDK versions add by default.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

function getStorage() {
  if (!cached) {
    const config = getR2Config()
    cached = { client: createStorageClient(config), bucket: config.bucketName }
  }

  return cached
}

function assertUuid(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a valid UUID`)
  }

  return value.toLowerCase()
}

// Keys are built from validated UUIDs and a restricted file name, never from raw client paths.
export function draftObjectKey(draftId, fileName) {
  if (typeof fileName !== 'string' || !FILE_NAME_PATTERN.test(fileName) || fileName.includes('..')) {
    throw new Error('Invalid file name')
  }

  return `drafts/${assertUuid(draftId, 'draftId')}/${fileName}`
}

export function orderZipKey(orderId) {
  return `orders/${assertUuid(orderId, 'orderId')}/website.zip`
}

// Immutable copy of the draft content taken when a checkout starts.
export function orderSnapshotKey(orderId) {
  return `orders/${assertUuid(orderId, 'orderId')}/snapshot`
}

// Also guards keys read from the database before they reach R2.
export function assertValidKey(key) {
  if (typeof key !== 'string' || key.includes('..') || !KEY_PATTERN.test(key)) {
    throw new Error('Invalid storage key')
  }

  return key
}

function normalizeBody(body) {
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  if (Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  if (body instanceof ArrayBuffer) return Buffer.from(body)

  throw new Error('Body must be a string, Buffer, Uint8Array or ArrayBuffer')
}

export async function putObject(key, body, { contentType = 'application/octet-stream', overwrite = true } = {}) {
  assertValidKey(key)

  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new Error(`Content type "${contentType}" is not allowed`)
  }

  const data = normalizeBody(body)

  if (data.byteLength === 0) throw new Error('Object body must not be empty')
  if (data.byteLength > MAX_OBJECT_SIZE_BYTES) {
    throw new Error(`Object exceeds the maximum size of ${MAX_OBJECT_SIZE_BYTES} bytes`)
  }

  const { client, bucket } = getStorage()

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        // Conditional write: with overwrite=false an existing object is never replaced.
        ...(overwrite ? {} : { IfNoneMatch: '*' }),
      }),
    )
  } catch (error) {
    if (!overwrite && error?.$metadata?.httpStatusCode === 412) {
      throw Object.assign(new Error('Object already exists'), { code: 'OBJECT_EXISTS' })
    }

    throw error
  }

  return { key, size: data.byteLength, contentType }
}

export async function getObject(key) {
  assertValidKey(key)

  const { client, bucket } = getStorage()

  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))

    if (response.ContentLength > MAX_OBJECT_SIZE_BYTES) {
      response.Body?.destroy?.()
      throw new Error('Stored object exceeds the maximum allowed size')
    }

    const body = Buffer.from(await response.Body.transformToByteArray())

    return { key, body, contentType: response.ContentType ?? 'application/octet-stream', size: body.byteLength }
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

export async function deleteObject(key) {
  assertValidKey(key)

  const { client, bucket } = getStorage()
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

export async function objectExists(key) {
  assertValidKey(key)

  const { client, bucket } = getStorage()

  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

function isNotFound(error) {
  return error?.name === 'NotFound' || error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404
}
