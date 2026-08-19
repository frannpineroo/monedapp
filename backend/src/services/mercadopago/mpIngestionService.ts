import { AccountKind, Currency, MovementType, Prisma } from '@prisma/client'
import { prisma } from '../../prisma/prisma'
import { resolveExchangeRateId } from '../exchangeRateService'
import { createLedgerForMovement } from '../ledgerService'
import { ensureProviderWallet } from '../integrationWalletService'
import { mapPaymentToOutcome, type MappedMovement, type MpPayment } from './mpPaymentMapper'
import { PROVIDER } from './mpOAuthService'

export type IngestResult = { status: 'posted' | 'skipped'; reason?: string; created: number }

const FEE_CATEGORY_NAME = 'Comisiones bancarias'

async function feeCategoryAccountId(tx: Prisma.TransactionClient, userId: string, mapped: MappedMovement) {
  if (!mapped.externalId.endsWith(':fee')) return null
  const account = await tx.account.findFirst({
    where: { userId, name: FEE_CATEGORY_NAME, kind: AccountKind.EXPENSE },
  })
  return account?.id ?? null
}

export async function ingestPayment(userId: string, payment: MpPayment): Promise<IngestResult> {
  const outcome = mapPaymentToOutcome(payment)

  if (outcome.kind === 'skip') return { status: 'skipped', reason: outcome.reason, created: 0 }
  if (outcome.kind === 'unsupported_currency') {
    return { status: 'skipped', reason: `unsupported_currency:${outcome.currency}`, created: 0 }
  }

  const currency = outcome.movements[0].currency as Currency
  const date = outcome.movements[0].date
  const updatedAt = payment.date_last_updated ? new Date(payment.date_last_updated) : new Date()

  // Fuera de la transacción: usa el cliente no-tx y es idempotente.
  const exchangeRateId = await resolveExchangeRateId(currency, date, 'blue')

  return prisma.$transaction(async (tx) => {
    // Serializa la ingesta por usuario sin necesidad de una cola; se libera al commitear.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'mp:' + userId}, 0))`

    const previous = await tx.movement.findFirst({
      where: { userId, externalProvider: PROVIDER, externalId: String(payment.id) },
    })
    if (previous?.externalUpdatedAt && previous.externalUpdatedAt >= updatedAt) {
      return { status: 'skipped' as const, reason: 'stale', created: 0 }
    }

    const wallet = await ensureProviderWallet(tx, userId, PROVIDER, currency)
    let created = 0

    // Límite conocido: un segundo reembolso parcial del mismo pago colisiona en
    // `<id>:reversal` y se traga como duplicado. Documentado, no resuelto.
    for (const mapped of outcome.movements) {
      try {
        const categoryAccountId = await feeCategoryAccountId(tx, userId, mapped)
        const movement = await tx.movement.create({
          data: {
            userId,
            walletId: wallet.id,
            type: mapped.type as MovementType,
            amount: new Prisma.Decimal(mapped.amount),
            currency,
            exchangeRateId,
            description: mapped.description,
            date: mapped.date,
            externalProvider: PROVIDER,
            externalId: mapped.externalId,
            externalStatus: payment.status,
            externalUpdatedAt: updatedAt,
            needsReview: mapped.needsReview,
            categoryAccountId,
          },
        })

        await createLedgerForMovement(tx, {
          userId,
          movementId: movement.id,
          type: movement.type,
          amount: movement.amount,
          currency: movement.currency,
          exchangeRateId,
          walletAccountId: wallet.accountId,
          categoryAccountId,
        })
        created++
      } catch (error) {
        // P2002 = ya lo posteamos por otra vía (otro webhook, o el sync). Es éxito.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue
        }
        throw error
      }
    }

    return { status: 'posted' as const, created }
  })
}
