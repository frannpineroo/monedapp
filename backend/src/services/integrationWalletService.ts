import { AccountKind, Currency, Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

const PROVIDER_LABELS: Record<string, string> = {
  mercadopago: 'Mercado Pago',
}

/** Idempotente: la unicidad la garantiza @@unique([userId, externalProvider, currency]). */
export async function ensureProviderWallet(
  tx: Tx,
  userId: string,
  provider: string,
  currency: Currency
) {
  const existing = await tx.wallet.findFirst({
    where: { userId, externalProvider: provider, currency },
  })
  if (existing) return existing

  const label = PROVIDER_LABELS[provider] ?? provider
  const preferredName = `${label} ${currency}`

  // Un INSERT que choque abortaría todo el tx de Postgres: mirar antes de crear.
  const nameTaken = await tx.account.findUnique({
    where: { userId_name: { userId, name: preferredName } },
  })
  const accountName = nameTaken ? `${preferredName} (integración)` : preferredName

  const account = await tx.account.create({
    data: { userId, name: accountName, kind: AccountKind.ASSET, currency },
  })

  return tx.wallet.create({
    data: {
      userId,
      accountId: account.id,
      currency,
      name: account.name,
      externalProvider: provider,
    },
  })
}
