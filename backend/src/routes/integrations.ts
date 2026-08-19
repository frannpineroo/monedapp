import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { AppError } from '../lib/errors'
import { serializeIntegration } from '../lib/serializers'
import { requireAuth, AuthedRequest } from '../middleware/auth'
import {
  disconnect,
  getIntegrationStatus,
  startConnect,
} from '../services/mercadopago/mpOAuthService'

const router = Router()
router.use(requireAuth)

function providerParam(value: string | string[] | undefined): string {
  if (typeof value !== 'string') {
    throw new AppError(400, 'Proveedor no soportado')
  }
  return value
}

function assertSupportedProvider(provider: string) {
  if (provider !== 'mercadopago') {
    throw new AppError(400, 'Proveedor no soportado')
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    const integrations = await getIntegrationStatus(userId)
    res.json(integrations.map(serializeIntegration))
  })
)

router.post(
  '/:provider/connect',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    assertSupportedProvider(providerParam(req.params.provider))

    const { mobileRedirectUri } = req.body as { mobileRedirectUri?: unknown }
    res.json(await startConnect(userId, mobileRedirectUri))
  })
)

router.delete(
  '/:provider',
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest
    assertSupportedProvider(providerParam(req.params.provider))

    await disconnect(userId)
    res.status(204).send()
  })
)

export default router
