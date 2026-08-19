import { MovementType, Prisma } from '@prisma/client'
import { prisma } from '../prisma/prisma'
import { ensureSystemAccounts } from './onboardingService'

export type ReceivableStatus = 'pending' | 'partial' | 'overdue' | 'paid'

const DAY_MS = 24 * 60 * 60 * 1000

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function startOfToday(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function deriveStatus(params: {
  amount: number
  outstanding: number
  dueDate: Date | null
}): ReceivableStatus {
  if (params.outstanding <= 0.01) return 'paid'
  if (params.dueDate && params.dueDate.getTime() < startOfToday().getTime()) return 'overdue'
  return params.outstanding < params.amount ? 'partial' : 'pending'
}

export async function listReceivables(
  userId: string,
  filters: { status?: string; clientId?: string } = {}
) {
  const { receivablesAccountId } = await ensureSystemAccounts(userId)

  const where: Prisma.MovementWhereInput = { userId, type: MovementType.invoice }
  if (filters.clientId) where.clientId = filters.clientId

  const invoices = await prisma.movement.findMany({
    where,
    include: {
      client: { select: { id: true, name: true, phone: true } },
      collections: {
        select: { id: true, amount: true, currency: true, date: true, walletId: true },
        orderBy: { date: 'asc' },
      },
    },
    orderBy: [{ dueDate: 'asc' }, { date: 'asc' }],
  })

  // Una sola consulta al ledger para todas las facturas: la pata sobre Deudores
  // de cada cobro dice cuánto canceló, en la moneda de la factura.
  const applied = await prisma.ledgerEntry.groupBy({
    by: ['movementId'],
    where: {
      accountId: receivablesAccountId,
      movement: { invoiceId: { in: invoices.map((i) => i.id) } },
    },
    _sum: { change: true },
  })

  const appliedByCollection = new Map(
    applied.map((row) => [row.movementId, Number(row._sum.change ?? 0)])
  )

  const today = startOfToday()

  const rows = invoices.map((invoice) => {
    const amount = round2(Number(invoice.amount))
    const collected = round2(
      -invoice.collections.reduce(
        (sum, c) => sum + (appliedByCollection.get(c.id) ?? 0),
        0
      )
    )
    const outstanding = round2(amount - collected)
    const status = deriveStatus({ amount, outstanding, dueDate: invoice.dueDate })
    const daysOverdue =
      status === 'overdue' && invoice.dueDate
        ? Math.floor((today.getTime() - invoice.dueDate.getTime()) / DAY_MS)
        : 0

    return {
      id: invoice.id,
      description: invoice.description,
      client: invoice.client,
      amount,
      currency: invoice.currency,
      date: invoice.date,
      dueDate: invoice.dueDate,
      collected,
      outstanding,
      status,
      daysOverdue,
      collections: invoice.collections,
    }
  })

  return filters.status ? rows.filter((row) => row.status === filters.status) : rows
}

export async function receivablesSummary(userId: string) {
  const rows = await listReceivables(userId)
  const pending = rows.filter((row) => row.status !== 'paid')

  const invoiceIds = pending.map((row) => row.id)
  const rates = await prisma.movement.findMany({
    where: { id: { in: invoiceIds } },
    select: { id: true, exchangeRate: { select: { value: true } } },
  })
  const rateById = new Map(rates.map((r) => [r.id, Number(r.exchangeRate.value)]))

  const byCurrency: Record<string, number> = {}
  const aging = { '0-30': 0, '31-60': 0, '61+': 0 }
  let totalArs = 0
  let overdueArs = 0

  for (const row of pending) {
    byCurrency[row.currency] = round2((byCurrency[row.currency] ?? 0) + row.outstanding)

    // Se usa el snapshot de la factura: es la cotización a la que se devengó.
    const ars = round2(row.outstanding * (rateById.get(row.id) ?? 1))
    totalArs = round2(totalArs + ars)

    if (row.status === 'overdue') {
      overdueArs = round2(overdueArs + ars)
      const bucket = row.daysOverdue <= 30 ? '0-30' : row.daysOverdue <= 60 ? '31-60' : '61+'
      aging[bucket] = round2(aging[bucket] + ars)
    }
  }

  return { byCurrency, totalArs, overdueArs, aging }
}
