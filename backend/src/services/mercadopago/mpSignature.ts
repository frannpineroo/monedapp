import crypto from 'crypto'

/** Template verbatim de MP: los pares ausentes se omiten, no quedan vacíos. */
export function buildManifest(parts: { dataId?: string; requestId?: string; ts: string }): string {
  const segments: string[] = []
  if (parts.dataId) segments.push(`id:${parts.dataId.toLowerCase()};`)
  if (parts.requestId) segments.push(`request-id:${parts.requestId};`)
  segments.push(`ts:${parts.ts};`)
  return segments.join('')
}

function parseSignatureHeader(header: string): Map<string, string> {
  const pairs = new Map<string, string>()
  for (const chunk of header.split(',')) {
    const [key, ...rest] = chunk.trim().split('=')
    if (key && rest.length > 0) pairs.set(key.trim(), rest.join('=').trim())
  }
  return pairs
}

export function verifyWebhookSignature(input: {
  xSignature?: string
  xRequestId?: string
  dataId?: string
  secret: string
}): boolean {
  if (!input.xSignature) return false

  const pairs = parseSignatureHeader(input.xSignature)
  const ts = pairs.get('ts')
  const v1 = pairs.get('v1')
  if (!ts || !v1) return false

  const manifest = buildManifest({ dataId: input.dataId, requestId: input.xRequestId, ts })
  const expected = crypto.createHmac('sha256', input.secret).update(manifest).digest('hex')

  // timingSafeEqual tira si los largos difieren: chequear antes.
  if (expected.length !== v1.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))
}
