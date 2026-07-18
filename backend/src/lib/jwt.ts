import jwt from 'jsonwebtoken'

const accessSecret = () => process.env.JWT_ACCESS_SECRET || 'dev-access-secret'
const refreshSecret = () => process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret'
const accessExpires = () => process.env.JWT_ACCESS_EXPIRES_IN || '15m'
const refreshExpires = () => process.env.JWT_REFRESH_EXPIRES_IN || '7d'

export type AccessPayload = { sub: string; email: string; type: 'access' }
export type RefreshPayload = { sub: string; type: 'refresh' }

export function signAccessToken(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email, type: 'access' } satisfies AccessPayload, accessSecret(), {
    expiresIn: accessExpires() as jwt.SignOptions['expiresIn'],
  })
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, type: 'refresh' } satisfies RefreshPayload, refreshSecret(), {
    expiresIn: refreshExpires() as jwt.SignOptions['expiresIn'],
  })
}

export function verifyAccessToken(token: string): AccessPayload {
  const payload = jwt.verify(token, accessSecret()) as AccessPayload
  if (payload.type !== 'access') throw new Error('Invalid token type')
  return payload
}

export function verifyRefreshToken(token: string): RefreshPayload {
  const payload = jwt.verify(token, refreshSecret()) as RefreshPayload
  if (payload.type !== 'refresh') throw new Error('Invalid token type')
  return payload
}

export function refreshExpiresAt(): Date {
  const expires = refreshExpires()
  const match = /^(\d+)([smhd])$/.exec(expires)
  const now = Date.now()
  if (!match) return new Date(now + 7 * 24 * 60 * 60 * 1000)
  const n = Number(match[1])
  const unit = match[2]
  const ms =
    unit === 's' ? n * 1000 :
    unit === 'm' ? n * 60 * 1000 :
    unit === 'h' ? n * 60 * 60 * 1000 :
    n * 24 * 60 * 60 * 1000
  return new Date(now + ms)
}
