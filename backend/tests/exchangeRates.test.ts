import { describe, expect, it } from 'vitest'
import { Currency } from '@prisma/client'
import {
  defaultTypeForCurrency,
  parseExchangeRateType,
  typesForCurrency,
} from '../src/services/exchangeRateService'

describe('exchange rates', () => {
  it('accepts cripto as a movement exchange-rate type', () => {
    expect(parseExchangeRateType('cripto')).toBe('cripto')
  })

  it('default por moneda: USDT → cripto, USD → blue', () => {
    expect(defaultTypeForCurrency(Currency.USDT)).toBe('cripto')
    expect(defaultTypeForCurrency(Currency.USD)).toBe('blue')
  })

  it('tipos por moneda', () => {
    expect(typesForCurrency(Currency.USD)).toEqual(['oficial', 'blue', 'mep'])
    expect(typesForCurrency(Currency.USDT)).toEqual(['cripto'])
    expect(typesForCurrency(Currency.ARS)).toEqual([])
  })
})
