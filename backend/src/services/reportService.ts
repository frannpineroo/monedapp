import { Prisma } from '@prisma/client'

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
