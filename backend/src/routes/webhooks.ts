import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma/prisma'
import { asyncHandler } from '../lib/asyncHandler'
import { mpConfig } from '../lib/env'
import { verifyWebhookSignature } from '../services/mercadopago/mpSignature'
import { getValidAccessToken, PROVIDER } from '../services/mercadopago/mpOAuthService'
import { getPayment } from '../services/mercadopago/mpClient'
import { ingestPayment } from '../services/mercadopago/mpIngestionService'

const router = Router()

router.post(
  '/mercadopago',
  asyncHandler(async (req, res) => {
    const dataIdQuery = req.query['data.id']
    const signatureOk = verifyWebhookSignature({
      xSignature: req.header('x-signature') ?? undefined,
      xRequestId: req.header('x-request-id') ?? undefined,
      dataId: typeof dataIdQuery === 'string' ? dataIdQuery : undefined,
      secret: mpConfig().webhookSecret,
    })

    if (!signatureOk) {
      res.status(401).json({ error: 'Firma inválida' })
      return
    }

    const body = req.body as {
      id?: number | string
      type?: string
      user_id?: number | string
      data?: { id?: string }
    }

    if (body.type !== 'payment') {
      res.json({ ignored: true })
      return
    }

    const notificationId = String(body.id ?? '')
    const resourceId = body.data?.id ? String(body.data.id) : null

    // Reentrega de la misma notificación: 200 y nada más.
    try {
      await prisma.integrationWebhookEvent.create({
        data: { provider: PROVIDER, notificationId, resourceId },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.json({ duplicate: true })
        return
      }
      throw error
    }

    const integration = await prisma.integration.findFirst({
      where: { provider: PROVIDER, externalAccountId: String(body.user_id ?? ''), status: 'connected' },
    })

    if (!integration || !resourceId) {
      // 200 a propósito: un 4xx haría que MP reintente días un evento que nunca va a matchear.
      await prisma.integrationWebhookEvent.updateMany({
        where: { provider: PROVIDER, notificationId },
        data: { status: 'ignored' },
      })
      res.json({ ignored: true })
      return
    }

    try {
      const accessToken = await getValidAccessToken(integration.userId)
      const payment = await getPayment(accessToken, resourceId)

      if (String(payment.collector_id ?? '') !== String(integration.externalAccountId)) {
        await prisma.integrationWebhookEvent.updateMany({
          where: { provider: PROVIDER, notificationId },
          data: { status: 'ignored', error: 'collector_mismatch' },
        })
        res.json({ ignored: true })
        return
      }

      await ingestPayment(integration.userId, payment)

      await prisma.integrationWebhookEvent.updateMany({
        where: { provider: PROVIDER, notificationId },
        data: { status: 'processed' },
      })
      await prisma.integration.update({
        where: { id: integration.id },
        data: { lastWebhookAt: new Date() },
      })

      res.json({ processed: true })
    } catch (error) {
      // Falla transitoria: un 500 es un reintento gratis de MP en 15 minutos.
      await prisma.integrationWebhookEvent.updateMany({
        where: { provider: PROVIDER, notificationId },
        data: { status: 'failed', error: error instanceof Error ? error.message : 'unknown' },
      })
      throw error
    }
  })
)

export default router
