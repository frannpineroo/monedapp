import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../lib/jwt'

export type AuthedRequest = Request & { userId: string; userEmail: string }

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No autorizado' })
    return
  }

  try {
    const payload = verifyAccessToken(header.slice(7))
    ;(req as AuthedRequest).userId = payload.sub
    ;(req as AuthedRequest).userEmail = payload.email
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' })
  }
}
