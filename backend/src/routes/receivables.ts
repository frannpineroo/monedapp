import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import { listReceivables } from '../services/receivablesService'

const router = Router()
router.use(requireAuth)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const { status, clientId } = req.query

    res.json(
      await listReceivables(userId, {
        status: typeof status === 'string' ? status : undefined,
        clientId: typeof clientId === 'string' ? clientId : undefined,
      })
    )
  })
)

export default router
