export type User = {
  id: string
  email: string
  profileTemplate: string | null
  monotributoCategory: string | null
  createdAt: string
}

export type AuthResponse = {
  user: User
  accessToken: string
  refreshToken: string
}

export type ProfileTemplate = {
  id: string
  name: string
  description: string
}

export type Wallet = {
  id: string
  currency: string
  name: string
  createdAt: string
  updatedAt: string
}

export type WalletBalance = {
  wallet: Wallet
  balance: string | number
  currency: string
}

export type Client = {
  id: string
  name: string
  phone: string | null
  defaultCurrency: string
  createdAt: string
  updatedAt: string
}

export type ExchangeRate = {
  id: string
  date: string
  type: 'oficial' | 'blue' | 'mep' | 'cripto'
  currency: string
  value: string | number
  buy: string | number | null
  sell: string | number | null
  source: 'dolarapi' | 'argentinadatos' | 'db-fallback' | 'stub' | 'fixed'
}

export type Movement = {
  id: string
  walletId: string
  clientId: string | null
  toWalletId: string | null
  type: 'income' | 'expense' | 'transfer'
  amount: string | number
  currency: string
  description: string
  date: string
  wallet?: { id: string; name: string; currency: string }
  client?: { id: string; name: string } | null
  exchangeRate?: ExchangeRate
}
