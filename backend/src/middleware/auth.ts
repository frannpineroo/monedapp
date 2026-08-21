import { Request, Response, NextFunction } from 'express'
import { prisma } from '../prisma/prisma'
import { verifyAccessToken } from '../lib/jwt'

export type AuthedRequest = Request & { userId: string; userEmail: string }

/**
 * La firma del token no alcanza: un token de un usuario borrado sigue verificando
 * bien y, sin este chequeo, las consultas devuelven listas vacías con 200 — la app
 * se ve cargada y sin datos en vez de mandar al login. Cuesta una consulta por
 * request, que es el precio de que el 401 llegue cuando tiene que llegar.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No autorizado' })
    return
  }

  let payload: { sub: string; email: string }
  try {
    payload = verifyAccessToken(header.slice(7))
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' })
    return
  }

  prisma.user
    .findUnique({ where: { id: payload.sub }, select: { id: true, email: true } })
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: 'Token inválido o expirado' })
        return
      }
      // El email sale de la fila, no del token: el token puede traer uno viejo.
      ;(req as AuthedRequest).userId = user.id
      ;(req as AuthedRequest).userEmail = user.email
      next()
    })
    .catch(next)
}
