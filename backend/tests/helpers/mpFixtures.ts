import type { MpPayment } from '../../src/services/mercadopago/mpPaymentMapper'

export const tokenResponse = {
  access_token: 'APP_USR-access-token',
  refresh_token: 'TG-refresh-token',
  expires_in: 15_552_000,
  user_id: 987654321,
  public_key: 'APP_USR-public-key',
  scope: 'offline_access read write',
  live_mode: false,
}

export function approvedPayment(overrides: Partial<MpPayment> = {}): MpPayment {
  return {
    id: 111111111,
    status: 'approved',
    status_detail: 'accredited',
    transaction_amount: 10000,
    transaction_amount_refunded: 0,
    transaction_details: { net_received_amount: 9310 },
    currency_id: 'ARS',
    date_approved: '2026-08-14T10:00:00.000-03:00',
    date_last_updated: '2026-08-14T10:01:00.000-03:00',
    collector_id: 987654321,
    description: 'Pago servicio',
    external_reference: null,
    ...overrides,
  }
}

export function refundedPayment(overrides: Partial<MpPayment> = {}): MpPayment {
  return approvedPayment({
    status: 'refunded',
    transaction_amount_refunded: 10000,
    date_last_updated: '2026-08-15T10:00:00.000-03:00',
    ...overrides,
  })
}

export function pendingPayment(overrides: Partial<MpPayment> = {}): MpPayment {
  return approvedPayment({ status: 'pending', ...overrides })
}

/** Rutea por URL: token, payment por id, search. Devuelve 404 para lo que no conoce. */
export function fakeMpFetch(routes: {
  token?: unknown
  payments?: Record<string, MpPayment>
  search?: MpPayment[]
}) {
  const calls: { url: string; init?: RequestInit }[] = []

  const fetchImpl = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })

    const respond = (status: number, body: unknown) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
      }) as unknown as Response

    if (url.includes('/oauth/token')) return respond(200, routes.token ?? tokenResponse)

    if (url.includes('/v1/payments/search')) {
      const results = routes.search ?? []
      return respond(200, { results, paging: { total: results.length } })
    }

    const match = url.match(/\/v1\/payments\/(\d+)/)
    if (match && routes.payments?.[match[1]]) {
      return respond(200, routes.payments[match[1]])
    }

    return respond(404, { message: 'not_found' })
  }

  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}
