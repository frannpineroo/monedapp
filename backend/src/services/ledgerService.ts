import { Currency, MovementType, Prisma } from '@prisma/client'
import { AppError } from '../lib/errors'
import { getDefaultExpenseAccountId, getDefaultIncomeAccountId } from './onboardingService'

type Tx = Prisma.TransactionClient

function assertBalanced(entries: { change: Prisma.Decimal | number }[]) {
  const total = entries.reduce((sum, e) => sum + Number(e.change), 0)
  if (Math.round(total * 100) / 100 !== 0) {
    throw new AppError(500, 'Asiento desbalanceado')
  }
}

export async function createLedgerForMovement(
  tx: Tx,
  params: {
    userId: string
    movementId: string
    type: MovementType
    amount: Prisma.Decimal
    currency: Currency
    walletAccountId: string
    toWalletAccountId?: string | null
  }
) {
  const amount = Number(params.amount)
  if (!(amount > 0)) {
    throw new AppError(400, 'El monto debe ser mayor a 0')
  }

  const entries: { accountId: string; change: number; currency: Currency }[] = []

  if (params.type === MovementType.income) {
    const incomeAccountId = await getDefaultIncomeAccountId(tx, params.userId)
    entries.push(
      { accountId: params.walletAccountId, change: amount, currency: params.currency },
      { accountId: incomeAccountId, change: -amount, currency: params.currency }
    )
  } else if (params.type === MovementType.expense) {
    const expenseAccountId = await getDefaultExpenseAccountId(tx, params.userId)
    entries.push(
      { accountId: expenseAccountId, change: amount, currency: params.currency },
      { accountId: params.walletAccountId, change: -amount, currency: params.currency }
    )
  } else if (params.type === MovementType.transfer) {
    if (!params.toWalletAccountId) {
      throw new AppError(400, 'Transferencia requiere billetera destino')
    }
    if (params.toWalletAccountId === params.walletAccountId) {
      throw new AppError(400, 'Las billeteras de origen y destino deben ser distintas')
    }
    entries.push(
      { accountId: params.toWalletAccountId, change: amount, currency: params.currency },
      { accountId: params.walletAccountId, change: -amount, currency: params.currency }
    )
  }

  assertBalanced(entries)

  await tx.ledgerEntry.createMany({
    data: entries.map((e) => ({
      movementId: params.movementId,
      accountId: e.accountId,
      change: e.change,
      currency: e.currency,
    })),
  })
}
