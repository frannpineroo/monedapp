import { MovementType, Prisma } from '@prisma/client'
import { prisma } from '../prisma/prisma'

type Numeric = Prisma.Decimal | number | string

/** El movimiento guarda el tipo de cambio del día en que ocurrió: se usa ese, no el de hoy. */
export function toArs(amount: Numeric, rateValue: Numeric): number {
  return Number(amount) * Number(rateValue)
}

export type CategoryTotal = {
  categoryId: string | null
  name: string
  total: number
  percent: number
}

export type CategorizedMovement = {
  categoryAccountId: string | null
  categoryAccount: { name: string } | null
  amount: Numeric
  exchangeRate: { value: Numeric }
}

export function sumByCategory(movements: CategorizedMovement[]): CategoryTotal[] {
  const totals = new Map<string, { categoryId: string | null; name: string; total: number }>()

  for (const movement of movements) {
    const key = movement.categoryAccountId ?? 'sin-categoria'
    const current = totals.get(key) ?? {
      categoryId: movement.categoryAccountId,
      name: movement.categoryAccount?.name ?? 'Sin categoría',
      total: 0,
    }
    current.total += toArs(movement.amount, movement.exchangeRate.value)
    totals.set(key, current)
  }

  const rows = [...totals.values()].sort((a, b) => b.total - a.total)
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0)

  return rows.map((row) => ({
    ...row,
    total: Math.round(row.total * 100) / 100,
    percent: grandTotal === 0 ? 0 : Math.round((row.total / grandTotal) * 10000) / 100,
  }))
}

/** Facturación devengada: la cobranza de algo ya facturado no vuelve a contar. */
export const BILLED_TYPES = [MovementType.income, MovementType.invoice]

export async function activeScales(at: Date) {
  const latest = await prisma.monotributoScale.findFirst({
    where: { validFrom: { lte: at } },
    orderBy: { validFrom: 'desc' },
  })
  if (!latest) return []

  return prisma.monotributoScale.findMany({
    where: { validFrom: latest.validFrom },
    orderBy: { annualGrossLimit: 'asc' },
  })
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export async function getMonotributoAlert(userId: string, now = new Date()) {
  const windowTo = now
  const windowFrom = new Date(now)
  windowFrom.setUTCMonth(windowFrom.getUTCMonth() - 12)

  const movements = await prisma.movement.findMany({
    where: { userId, type: { in: BILLED_TYPES }, date: { gte: windowFrom, lte: windowTo } },
    select: { amount: true, exchangeRate: { select: { value: true } } },
  })

  const incomeArs12m = round2(
    movements.reduce((sum, m) => sum + toArs(m.amount, m.exchangeRate.value), 0)
  )

  const scales = await activeScales(now)
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })

  const suggested = scales.find((s) => Number(s.annualGrossLimit) >= incomeArs12m) ?? null
  const chosen = user.monotributoCategory
    ? (scales.find((s) => s.category === user.monotributoCategory) ?? null)
    : null

  const reference = chosen ?? suggested
  const limit = reference ? Number(reference.annualGrossLimit) : null
  const percentUsed = limit ? round2((incomeArs12m / limit) * 100) : null

  let status: 'unset' | 'ok' | 'warning' | 'exceeded'
  if (!suggested) {
    status = 'exceeded'
  } else if (!chosen) {
    status = 'unset'
  } else if (incomeArs12m > Number(chosen.annualGrossLimit)) {
    status = 'exceeded'
  } else if (incomeArs12m >= Number(chosen.annualGrossLimit) * 0.8) {
    status = 'warning'
  } else {
    status = 'ok'
  }

  return {
    status,
    category: chosen?.category ?? null,
    suggestedCategory: suggested?.category ?? null,
    incomeArs12m,
    limit,
    percentUsed,
    remaining: limit === null ? null : round2(limit - incomeArs12m),
    monthlyFee: reference ? Number(reference.monthlyFeeServices) : null,
    windowFrom,
    windowTo,
    scales: scales.map((s) => ({
      category: s.category,
      annualGrossLimit: Number(s.annualGrossLimit),
      monthlyFeeServices: Number(s.monthlyFeeServices),
    })),
  }
}
