import { createHash } from 'node:crypto'
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3'
import { fail } from './validation.js'

export function createStorage (env = process.env) {
  const store = new S3Client({
    endpoint: env.S3_ENDPOINT || undefined,
    region: env.S3_REGION || 'us-east-1',
    forcePathStyle: Boolean(env.S3_ENDPOINT),
    credentials: { accessKeyId: env.S3_ACCESS_KEY || '', secretAccessKey: env.S3_SECRET_KEY || '' }
  })
  const ipfs = new S3Client({
    endpoint: 'https://endpoint.4everland.co',
    region: '4EVERLAND',
    forcePathStyle: true,
    credentials: { accessKeyId: env.EVERLAND_ACCESS_KEY || '', secretAccessKey: env.EVERLAND_SECRET_KEY || '' }
  })
  const ready = [env.S3_BUCKET, env.S3_ACCESS_KEY, env.S3_SECRET_KEY, env.EVERLAND_BUCKET_NAME, env.EVERLAND_ACCESS_KEY, env.EVERLAND_SECRET_KEY].every(Boolean)
  function configured () { if (!ready) fail('Storage is not configured', 503) }
  async function get (key) {
    configured()
    try {
      const result = await store.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), { abortSignal: AbortSignal.timeout(10000) })
      return JSON.parse(await result.Body.transformToString())
    } catch (error) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) return null
      throw error
    }
  }
  async function put (key, value) {
    configured()
    try {
      await store.send(new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: 'application/json',
        IfNoneMatch: '*'
      }), { abortSignal: AbortSignal.timeout(10000) })
    } catch (error) {
      if ([409, 412].includes(error.$metadata?.httpStatusCode)) fail('This record already exists', 409)
      throw error
    }
  }
  async function list (prefix, cursor, limit = 50) {
    configured()
    const page = await store.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix, ContinuationToken: cursor, MaxKeys: limit }), { abortSignal: AbortSignal.timeout(10000) })
    const items = []
    for (const object of page.Contents || []) items.push(await get(object.Key))
    return { items: items.filter(Boolean), cursor: page.NextContinuationToken || null }
  }
  async function pin (envelope) {
    configured()
    const body = JSON.stringify(envelope)
    const key = `solana-voting/${createHash('sha256').update(body).digest('hex')}.json`
    await ipfs.send(new PutObjectCommand({ Bucket: env.EVERLAND_BUCKET_NAME, Key: key, Body: body, ContentType: 'application/json' }), { abortSignal: AbortSignal.timeout(10000) })
    const head = await ipfs.send(new HeadObjectCommand({ Bucket: env.EVERLAND_BUCKET_NAME, Key: key }), { abortSignal: AbortSignal.timeout(10000) })
    const hash = head.Metadata?.['ipfs-hash']
    if (!hash || !/^[a-zA-Z0-9]{20,128}$/.test(hash)) fail('4EVERLAND did not return an IPFS CID', 502)
    return hash
  }
  return { get, put, list, pin, ready }
}
