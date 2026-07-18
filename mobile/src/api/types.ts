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
}
