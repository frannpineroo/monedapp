import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CASA_BY_TYPE, fetchHistoricalRate, fetchLiveRate } from '../src/services/fxProvider'

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response
}

describe('fxProvider.fetchLiveRate', () => {
  beforeEach(() => {
    process.env.FX_ENABLED = 'true'
    process.env.FX_BASE_URL = 'https://fx.test/v1/dolares'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.FX_BASE_URL
  })

  it('mapea mep a la casa bolsa', () => {
    expect(CASA_BY_TYPE.mep).toBe('bolsa')
    expect(CASA_BY_TYPE.cripto).toBe('cripto')
  })

  it('respuesta ok → {buy, sell, source: dolarapi} y pega a la casa correcta', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ compra: 1500, venta: 1530, casa: 'blue' })
    )
    vi.stubGlobal('fetch', fetchMock)

    const quote = await fetchLiveRate('blue')

    expect(quote).toEqual({ buy: 1500, sell: 1530, source: 'dolarapi' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://fx.test/v1/dolares/blue')
  })

  it('venta no numérica → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ compra: 1500, venta: null })))

    expect(await fetchLiveRate('blue')).toBeNull()
  })

  it('fetch que rechaza → null, no lanza', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))

    expect(await fetchLiveRate('oficial')).toBeNull()
  })

  it('FX_ENABLED=false → null sin tocar la red', async () => {
    process.env.FX_ENABLED = 'false'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchLiveRate('blue')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('fxProvider.fetchHistoricalRate', () => {
  beforeEach(() => {
    process.env.FX_ENABLED = 'true'
    process.env.FX_HISTORICAL_BASE_URL = 'https://hist.test/v1/cotizaciones/dolares'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.FX_HISTORICAL_BASE_URL
  })

  it('arma el path yyyy/MM/dd en UTC y devuelve source argentinadatos', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ compra: 1490, venta: 1530, fecha: '2026-07-18' })
    )
    vi.stubGlobal('fetch', fetchMock)

    const quote = await fetchHistoricalRate('blue', new Date(Date.UTC(2026, 6, 18)))

    expect(quote).toEqual({ buy: 1490, sell: 1530, source: 'argentinadatos' })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://hist.test/v1/cotizaciones/dolares/blue/2026/07/18'
    )
  })

  it('404 → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response))

    expect(await fetchHistoricalRate('mep', new Date(Date.UTC(2026, 0, 5)))).toBeNull()
  })
})
