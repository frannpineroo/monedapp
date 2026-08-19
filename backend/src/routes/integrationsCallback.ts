import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { completeConnect } from '../services/mercadopago/mpOAuthService'

const router = Router()

/**
 * Sin requireAuth: el navegador que trae a MP no tiene el JWT.
 * El userId viaja en la fila de state, del lado del servidor.
 * Siempre redirige: el usuario nunca ve una página de error del backend.
 */
router.get(
  '/:provider/callback',
  asyncHandler(async (req, res) => {
    const { code, state } = req.query
    const fallback = `${process.env.MOBILE_DEEP_LINK_SCHEME || 'monedapp'}://integrations/${req.params.provider}`

    if (req.params.provider !== 'mercadopago') {
      res.redirect(302, `${fallback}?status=error&reason=unsupported_provider`)
      return
    }

    try {
      const { mobileRedirectUri } = await completeConnect({ state, code })
      res.redirect(302, `${mobileRedirectUri}?status=connected`)
    } catch (error) {
      const reason = error instanceof Error ? encodeURIComponent(error.message) : 'unknown'
      res.redirect(302, `${fallback}?status=error&reason=${reason}`)
    }
  })
)

export default router
