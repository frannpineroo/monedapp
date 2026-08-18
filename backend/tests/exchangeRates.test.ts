import { describe, expect, it } from 'vitest'
import { parseExchangeRateType } from '../src/services/exchangeRateService'

describe('exchange rates', () => {
  it('accepts cripto as a movement exchange-rate type', () => {
    expect(parseExchangeRateType('cripto')).toBe('cripto')
  })
})
