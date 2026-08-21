import { Router } from 'express'
import { prisma } from '../prisma/prisma'
import { asyncHandler } from '../lib/asyncHandler'
import { AppError } from '../lib/errors'
import { serializeUser } from '../lib/serializers'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { activeScales } from '../services/reportService'

const router = Router()
router.use(requireAuth)

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    res.json(serializeUser(user))
  })
)

router.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { monotributoCategory } = req.body as { monotributoCategory?: unknown }

    if (monotributoCategory === undefined) {
      throw new AppError(400, 'monotributoCategory es requerido')
    }

    let value: string | null = null
    if (monotributoCategory !== null) {
      if (typeof monotributoCategory !== 'string') {
        throw new AppError(400, 'monotributoCategory inválida')
      }
      const scales = await activeScales(new Date())
      if (!scales.some((s) => s.category === monotributoCategory)) {
        throw new AppError(400, 'Categoría de monotributo inválida')
      }
      value = monotributoCategory
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { monotributoCategory: value },
    })
    res.json(serializeUser(user))
  })
)

export default router
