import type { Movement, WalletBalance } from '@/src/api/types'
import type { Tone } from '@/src/ui'

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

/**
 * El color del monto según de qué lado del ledger está.
 *
 * Ingresos y cobros entran (verde), los gastos salen (rojo), y las
 * transferencias y facturas son neutras: mueven o devengan, pero no cambian
 * cuánta plata hay.
 */
export function toneForType(type: Movement['type']): Tone {
  if (type === 'income' || type === 'collection') return 'positive'
  if (type === 'expense') return 'expense'
  return 'muted'
}

/**
 * El signo que acompaña al monto. Va siempre junto a `toneForType`: el color
 * nunca viaja solo, que es lo que hace la app usable con daltonismo.
 * Los gastos se guardan en positivo, así que el `-` lo pone la vista.
 */
export function signForType(type: Movement['type']): '+' | '-' | undefined {
  if (type === 'expense') return '-'
  if (type === 'income' || type === 'collection') return '+'
  return undefined
}

