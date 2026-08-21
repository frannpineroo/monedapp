import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { AppError } from '../lib/errors'
import { serializeUser } from '../lib/serializers'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { applyOnboarding, listProfileTemplates } from '../services/onboardingService'

const router = Router()

router.get(
  '/profile-templates',
  asyncHandler(async (_req, res) => {
    res.json(listProfileTemplates())
  })
)

router.post(
  '/users/me/onboarding',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { templateId } = req.body as { templateId?: unknown }

    if (typeof templateId !== 'string') {
      throw new AppError(400, 'templateId es requerido')
    }

    const user = await applyOnboarding(userId, templateId)
    res.json(serializeUser(user))
  })
)

export default router
