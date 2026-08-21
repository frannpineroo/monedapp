import type { WalletBalance } from '@/src/api/types'

export function formatAmount(value: string | number, currency: string) {
  const n = Number(value)
  return `${currency} ${n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Suma saldos agrupados por moneda (solo monedas con billeteras). */
export function groupBalancesByCurrency(balances: WalletBalance[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const item of balances) {
    const currency = item.currency
    totals[currency] = (totals[currency] ?? 0) + Number(item.balance)
  }
  return totals
}

/** Plata grande: los centavos sobran y estorban. */
export function formatArs(value: string | number) {
  return `ARS ${Number(value).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

export function formatPercent(value: string | number) {
  return `${Number(value).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`
}
