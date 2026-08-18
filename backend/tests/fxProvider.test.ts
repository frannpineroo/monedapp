import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CASA_BY_TYPE, fetchLiveRate } from '../src/services/fxProvider'

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
