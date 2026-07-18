import { Request, Response, RequestHandler } from 'express'
import { Prisma } from '@prisma/client'
import { AppError } from './errors'

function handleError(error: unknown, res: Response) {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message })
    return
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'El registro ya existe' })
      return
    }
    if (error.code === 'P2003') {
      res.status(400).json({ error: 'Referencia inválida' })
      return
    }
  }

  console.error(error)
  res.status(500).json({ error: 'Error interno del servidor' })
}

export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>
): RequestHandler {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((error) => handleError(error, res))
  }
}
