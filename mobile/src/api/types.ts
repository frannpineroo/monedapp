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

export type Category = {
  id: string
  name: string
  kind: 'EXPENSE' | 'INCOME'
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
  walletId: string | null
  clientId: string | null
  toWalletId: string | null
  type: 'income' | 'expense' | 'transfer' | 'invoice' | 'collection'
  amount: string | number
  currency: string
  description: string
  date: string
  dueDate?: string | null
  invoiceId?: string | null
  needsReview?: boolean
  source?: string
  wallet?: { id: string; name: string; currency: string }
  client?: { id: string; name: string } | null
  category?: { id: string; name: string } | null
  exchangeRate?: ExchangeRate
}

export type ReceivableStatus = 'pending' | 'partial' | 'overdue' | 'paid'

export type Receivable = {
  id: string
  description: string
  client: { id: string; name: string; phone: string | null } | null
  amount: number
  currency: string
  date: string
  dueDate: string | null
  collected: number
  outstanding: number
  status: ReceivableStatus
  daysOverdue: number
  collections: { id: string; amount: string | number; currency: string; date: string }[]
}

export type ReceivablesSummary = {
  byCurrency: Record<string, number>
  totalArs: number
  overdueArs: number
  aging: { '0-30': number; '31-60': number; '61+': number }
}

export type Integration = {
  provider: string
  status: 'connected' | 'disconnected' | 'error'
  externalAccountId: string | null
  lastSyncAt: string | null
  lastWebhookAt: string | null
  lastError: string | null
}

export type ConnectResponse = { authorizationUrl: string }
export type SyncResult = { scanned: number; created: number }
