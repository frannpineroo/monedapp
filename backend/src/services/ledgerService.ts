import { Currency, MovementType, Prisma } from '@prisma/client'
import { AppError } from '../lib/errors'
import { getDefaultExpenseAccountId, getDefaultIncomeAccountId, ensureSystemAccounts } from './onboardingService'

type Tx = Prisma.TransactionClient

export type LedgerEntryInput = {
  accountId: string
  change: number
  currency: Currency
  changeArs: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * El ARS es la única unidad comparable entre patas: sumar montos de monedas
 * distintas (como se hacía antes) es un bug silencioso en cuanto aparece un
 * asiento multi-moneda, que es exactamente lo que trae el cobro con diferencia
 * de cambio.
 */
export function assertBalanced(
  entries: LedgerEntryInput[],
  opts: { allowsMultiCurrency?: boolean } = {}
) {
  const totalArs = entries.reduce((sum, e) => sum + e.changeArs, 0)
  if (round2(totalArs) !== 0) {
    throw new AppError(500, 'Asiento desbalanceado')
  }

  if (opts.allowsMultiCurrency) return

  const byCurrency = new Map<Currency, number>()
  for (const entry of entries) {
    byCurrency.set(entry.currency, (byCurrency.get(entry.currency) ?? 0) + entry.change)
  }
  for (const total of byCurrency.values()) {
    if (round2(total) !== 0) {
      throw new AppError(500, 'Asiento desbalanceado')
    }
  }
}

export async function writeEntries(
  tx: Tx,
  movementId: string,
  entries: LedgerEntryInput[],
  opts: { allowsMultiCurrency?: boolean } = {}
) {
  assertBalanced(entries, opts)

  await tx.ledgerEntry.createMany({
    data: entries.map((e) => ({
      movementId,
      accountId: e.accountId,
      change: e.change,
      changeArs: e.changeArs,
      currency: e.currency,
    })),
  })
}

export async function createLedgerForMovement(
  tx: Tx,
  params: {
    userId: string
    movementId: string
    type: MovementType
    amount: Prisma.Decimal
    currency: Currency
    exchangeRateId: string
    walletAccountId: string
    toWalletAccountId?: string | null
    categoryAccountId?: string | null
  }
) {
  const amount = Number(params.amount)
  if (!(amount > 0)) {
    throw new AppError(400, 'El monto debe ser mayor a 0')
  }

  const rate = await tx.exchangeRate.findUniqueOrThrow({ where: { id: params.exchangeRateId } })
  const rateValue = Number(rate.value)
  const arsOf = (value: number) => round2(value * rateValue)

  const entries: LedgerEntryInput[] = []

  if (params.type === MovementType.income) {
    const incomeAccountId =
      params.categoryAccountId ?? (await getDefaultIncomeAccountId(tx, params.userId))
    entries.push(
      {
        accountId: params.walletAccountId,
        change: amount,
        currency: params.currency,
        changeArs: arsOf(amount),
      },
      {
        accountId: incomeAccountId,
        change: -amount,
        currency: params.currency,
        changeArs: -arsOf(amount),
      }
    )
  } else if (params.type === MovementType.expense) {
    const expenseAccountId =
      params.categoryAccountId ?? (await getDefaultExpenseAccountId(tx, params.userId))
    entries.push(
      {
        accountId: expenseAccountId,
        change: amount,
        currency: params.currency,
        changeArs: arsOf(amount),
      },
      {
        accountId: params.walletAccountId,
        change: -amount,
        currency: params.currency,
        changeArs: -arsOf(amount),
      }
    )
  } else if (params.type === MovementType.transfer) {
    if (!params.toWalletAccountId) {
      throw new AppError(400, 'Transferencia requiere billetera destino')
    }
    if (params.toWalletAccountId === params.walletAccountId) {
      throw new AppError(400, 'Las billeteras de origen y destino deben ser distintas')
    }
    entries.push(
      {
        accountId: params.toWalletAccountId,
        change: amount,
        currency: params.currency,
        changeArs: arsOf(amount),
      },
      {
        accountId: params.walletAccountId,
        change: -amount,
        currency: params.currency,
        changeArs: -arsOf(amount),
      }
    )
  }

  await writeEntries(tx, params.movementId, entries)
}

export async function createInvoiceLedger(
  tx: Tx,
  params: {
    userId: string
    movementId: string
    amount: Prisma.Decimal
    currency: Currency
    exchangeRateId: string
    categoryAccountId?: string | null
  }
) {
  const amount = Number(params.amount)
  if (!(amount > 0)) throw new AppError(400, 'El monto debe ser mayor a 0')

  const { receivablesAccountId } = await ensureSystemAccounts(params.userId)
  const incomeAccountId =
    params.categoryAccountId ?? (await getDefaultIncomeAccountId(tx, params.userId))

  const rate = await tx.exchangeRate.findUniqueOrThrow({ where: { id: params.exchangeRateId } })
  const ars = round2(amount * Number(rate.value))

  // La factura no toca ninguna billetera: por eso balance-by-wallet no se mueve.
  await writeEntries(tx, params.movementId, [
    { accountId: receivablesAccountId, change: amount, currency: params.currency, changeArs: ars },
    { accountId: incomeAccountId, change: -amount, currency: params.currency, changeArs: -ars },
  ])
}

/**
 * El saldo pendiente sale del ledger, no de una columna: cada cobro deja una pata
 * negativa sobre Deudores en la moneda de la factura.
 */
export async function outstandingForInvoice(
  tx: Tx,
  invoice: { id: string; userId: string; amount: Prisma.Decimal }
): Promise<number> {
  const { receivablesAccountId } = await ensureSystemAccounts(invoice.userId)

  const applied = await tx.ledgerEntry.aggregate({
    where: {
      accountId: receivablesAccountId,
      movement: { invoiceId: invoice.id },
    },
    _sum: { change: true },
  })

  return round2(Number(invoice.amount) + Number(applied._sum.change ?? 0))
}

export async function createCollectionLedger(
  tx: Tx,
  params: {
    userId: string
    movementId: string
    invoice: { id: string; userId: string; amount: Prisma.Decimal; currency: Currency; exchangeRateId: string }
    walletAccountId: string
    amount: Prisma.Decimal
    currency: Currency
    exchangeRateId: string
  }
) {
  const collected = Number(params.amount)
  if (!(collected > 0)) throw new AppError(400, 'El monto debe ser mayor a 0')

  const { receivablesAccountId, fxDifferenceAccountId } = await ensureSystemAccounts(params.userId)

  const collectionRate = await tx.exchangeRate.findUniqueOrThrow({
    where: { id: params.exchangeRateId },
  })
  const invoiceRate = await tx.exchangeRate.findUniqueOrThrow({
    where: { id: params.invoice.exchangeRateId },
  })

  const collectedArs = round2(collected * Number(collectionRate.value))
  // Cuánto de la deuda cancela, en la moneda de la factura, usando ambos snapshots.
  const appliedRaw =
    params.currency === params.invoice.currency
      ? collected
      : collectedArs / Number(invoiceRate.value)

  const outstanding = await outstandingForInvoice(tx, params.invoice)
  const applied = round2(Math.min(appliedRaw, outstanding))

  if (round2(appliedRaw) > round2(outstanding + 0.01)) {
    throw new AppError(400, 'El cobro supera el saldo pendiente')
  }

  const appliedArs = round2(applied * Number(invoiceRate.value))
  const fxDifference = round2(appliedArs - collectedArs)

  const entries: LedgerEntryInput[] = [
    {
      accountId: params.walletAccountId,
      change: collected,
      currency: params.currency,
      changeArs: collectedArs,
    },
    {
      accountId: receivablesAccountId,
      change: -applied,
      currency: params.invoice.currency,
      changeArs: -appliedArs,
    },
  ]

  if (fxDifference !== 0 || params.currency !== params.invoice.currency) {
    entries.push({
      accountId: fxDifferenceAccountId,
      change: fxDifference,
      currency: Currency.ARS,
      changeArs: fxDifference,
    })
  }

  // Único asiento del sistema con patas en monedas distintas: balancea solo en ARS.
  await writeEntries(tx, params.movementId, entries, {
    allowsMultiCurrency: params.currency !== params.invoice.currency,
  })
}
