export type MpPayment = {
  id: number | string
  status: string
  status_detail?: string | null
  transaction_amount: number
  transaction_amount_refunded?: number | null
  transaction_details?: { net_received_amount?: number | null } | null
  currency_id: string
  date_approved?: string | null
  date_last_updated?: string | null
  collector_id?: number | string | null
  description?: string | null
  external_reference?: string | null
}

export type MappedMovement = {
  externalId: string
  type: 'income' | 'expense'
  amount: number
  currency: 'ARS' | 'USD'
  description: string
  date: Date
  needsReview: boolean
}

export type MpOutcome =
  | { kind: 'post'; movements: MappedMovement[] }
  | { kind: 'reverse'; movements: MappedMovement[] }
  | { kind: 'skip'; reason: string }
  | { kind: 'unsupported_currency'; currency: string }

const REVERSED_STATUSES = new Set(['refunded', 'charged_back'])

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * MP devuelve `…T22:30:00.000-03:00`. Truncar en UTC mandaría todo pago de la tarde
 * al día siguiente: se resta el offset de Buenos Aires antes de truncar.
 */
export function argentineBusinessDate(iso: string): Date {
  const instant = new Date(iso)
  const local = new Date(instant.getTime() - 3 * 60 * 60 * 1000)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()))
}

function describe(payment: MpPayment): string {
  return payment.description?.trim() || payment.external_reference?.trim() || 'Cobro Mercado Pago'
}

export function mapPaymentToOutcome(payment: MpPayment): MpOutcome {
  if (payment.currency_id !== 'ARS' && payment.currency_id !== 'USD') {
    return { kind: 'unsupported_currency', currency: payment.currency_id }
  }

  const currency = payment.currency_id
  const externalId = String(payment.id)
  const date = argentineBusinessDate(
    payment.date_approved ?? payment.date_last_updated ?? new Date().toISOString()
  )
  const refunded = round2(Number(payment.transaction_amount_refunded ?? 0))

  if (REVERSED_STATUSES.has(payment.status)) {
    return {
      kind: 'reverse',
      movements: [
        {
          externalId: `${externalId}:reversal`,
          type: 'expense',
          amount: refunded > 0 ? refunded : round2(payment.transaction_amount),
          currency,
          description:
            payment.status === 'charged_back'
              ? 'Contracargo Mercado Pago'
              : 'Reembolso Mercado Pago',
          date,
          needsReview: true,
        },
      ],
    }
  }

  if (payment.status !== 'approved') {
    return { kind: 'skip', reason: payment.status }
  }

  const gross = round2(payment.transaction_amount)
  const net = round2(Number(payment.transaction_details?.net_received_amount ?? gross))
  const fee = round2(gross - net)

  const movements: MappedMovement[] = [
    {
      externalId,
      type: 'income',
      amount: gross,
      currency,
      description: describe(payment),
      date,
      needsReview: true,
    },
  ]

  if (fee > 0) {
    movements.push({
      externalId: `${externalId}:fee`,
      type: 'expense',
      amount: fee,
      currency,
      description: 'Comisión Mercado Pago',
      date,
      needsReview: false,
    })
  }

  if (refunded > 0) {
    movements.push({
      externalId: `${externalId}:reversal`,
      type: 'expense',
      amount: refunded,
      currency,
      description: 'Reembolso Mercado Pago',
      date,
      needsReview: true,
    })
  }

  return { kind: 'post', movements }
}
