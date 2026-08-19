import { prisma } from '../../prisma/prisma'
import { searchPayments } from './mpClient'
import { getValidAccessToken, PROVIDER } from './mpOAuthService'
import { ingestPayment } from './mpIngestionService'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_PAGES = 20

export async function syncMercadoPago(
  userId: string,
  range: { from?: Date; to?: Date } = {}
): Promise<{ scanned: number; created: number }> {
  const accessToken = await getValidAccessToken(userId)

  const to = range.to ?? new Date()
  const requestedFrom = range.from ?? new Date(to.getTime() - 30 * DAY_MS)
  // MP solo permite ventanas menores a 365 días, y solo los últimos 12 meses.
  const earliest = new Date(to.getTime() - 364 * DAY_MS)
  const from = requestedFrom < earliest ? earliest : requestedFrom

  let scanned = 0
  let created = 0

  for (let page = 0; page < MAX_PAGES; page++) {
    const { results } = await searchPayments(accessToken, { from, to, offset: page * 50 })
    if (results.length === 0) break

    for (const payment of results) {
      scanned++
      // Mismo camino que el webhook: un pago ya posteado se deduplica solo.
      const result = await ingestPayment(userId, payment)
      created += result.created
    }

    if (results.length < 50) break
  }

  await prisma.integration.updateMany({
    where: { userId, provider: PROVIDER },
    data: { lastSyncAt: new Date() },
  })

  return { scanned, created }
}
