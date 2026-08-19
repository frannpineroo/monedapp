import { describe, expect, it } from 'vitest'
import {
  argentineBusinessDate,
  mapPaymentToOutcome,
  type MpPayment,
} from '../src/services/mercadopago/mpPaymentMapper'

function payment(overrides: Partial<MpPayment> = {}): MpPayment {
  return {
    id: 123456789,
    status: 'approved',
    status_detail: 'accredited',
    transaction_amount: 10000,
    transaction_amount_refunded: 0,
    transaction_details: { net_received_amount: 9310 },
    currency_id: 'ARS',
    date_approved: '2026-08-14T22:30:00.000-03:00',
    date_last_updated: '2026-08-14T22:31:00.000-03:00',
    collector_id: 555,
    description: 'Pago servicio',
    external_reference: null,
    ...overrides,
  }
}

describe('argentineBusinessDate', () => {
  it('un pago de la noche no se corre al día siguiente', () => {
    expect(argentineBusinessDate('2026-08-14T22:30:00.000-03:00').toISOString()).toBe(
      '2026-08-14T00:00:00.000Z'
    )
  })

  it('un pago de la mañana queda en su día', () => {
    expect(argentineBusinessDate('2026-08-14T09:15:00.000-03:00').toISOString()).toBe(
      '2026-08-14T00:00:00.000Z'
    )
  })
})

describe('mapPaymentToOutcome', () => {
  it('approved sin reembolso → ingreso bruto + gasto de comisión', () => {
    const outcome = mapPaymentToOutcome(payment())

    expect(outcome.kind).toBe('post')
    if (outcome.kind !== 'post') return

    const [income, fee] = outcome.movements
    expect(income).toMatchObject({
      externalId: '123456789',
      type: 'income',
      amount: 10000,
      currency: 'ARS',
      description: 'Pago servicio',
      needsReview: true,
    })
    expect(fee).toMatchObject({
      externalId: '123456789:fee',
      type: 'expense',
      amount: 690,
      description: 'Comisión Mercado Pago',
      needsReview: false,
    })
  })

  it('sin comisión no emite el segundo movimiento', () => {
    const outcome = mapPaymentToOutcome(
      payment({ transaction_details: { net_received_amount: 10000 } })
    )

    expect(outcome.kind).toBe('post')
    if (outcome.kind !== 'post') return
    expect(outcome.movements).toHaveLength(1)
  })

  it('sin descripción cae a external_reference y después al default', () => {
    const conRef = mapPaymentToOutcome(
      payment({ description: null, external_reference: 'FACTURA-9' })
    )
    const sinNada = mapPaymentToOutcome(payment({ description: '  ', external_reference: null }))

    expect(conRef.kind === 'post' && conRef.movements[0].description).toBe('FACTURA-9')
    expect(sinNada.kind === 'post' && sinNada.movements[0].description).toBe('Cobro Mercado Pago')
  })

  it('refunded → asiento compensatorio', () => {
    const outcome = mapPaymentToOutcome(
      payment({ status: 'refunded', transaction_amount_refunded: 10000 })
    )

    expect(outcome.kind).toBe('reverse')
    if (outcome.kind !== 'reverse') return
    expect(outcome.movements[0]).toMatchObject({
      externalId: '123456789:reversal',
      type: 'expense',
      amount: 10000,
      description: 'Reembolso Mercado Pago',
      needsReview: true,
    })
  })

  it('charged_back usa su propia descripción', () => {
    const outcome = mapPaymentToOutcome(
      payment({ status: 'charged_back', transaction_amount_refunded: 10000 })
    )

    expect(outcome.kind === 'reverse' && outcome.movements[0].description).toBe(
      'Contracargo Mercado Pago'
    )
  })

  it('approved con reembolso parcial postea y revierte la diferencia', () => {
    const outcome = mapPaymentToOutcome(payment({ transaction_amount_refunded: 2500 }))

    expect(outcome.kind).toBe('post')
    if (outcome.kind !== 'post') return
    const reversal = outcome.movements.find((m) => m.externalId.endsWith(':reversal'))
    expect(reversal).toMatchObject({ type: 'expense', amount: 2500 })
  })

  it.each(['pending', 'in_process', 'authorized', 'in_mediation', 'rejected', 'cancelled'])(
    '%s → skip',
    (status) => {
      expect(mapPaymentToOutcome(payment({ status })).kind).toBe('skip')
    }
  )

  it('moneda no soportada no se postea', () => {
    const outcome = mapPaymentToOutcome(payment({ currency_id: 'BRL' }))

    expect(outcome).toEqual({ kind: 'unsupported_currency', currency: 'BRL' })
  })
})
