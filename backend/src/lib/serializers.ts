import { Client, Movement, Wallet } from '@prisma/client'

export function serializeWallet(wallet: Wallet) {
  return {
    id: wallet.id,
    currency: wallet.currency,
    name: wallet.name,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  }
}

export function serializeClient(client: Client) {
  return {
    id: client.id,
    name: client.name,
    defaultCurrency: client.defaultCurrency,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  }
}

export function serializeMovement(
  movement: Movement & {
    wallet?: { id: string; name: string; currency: string }
    client?: { id: string; name: string } | null
  }
) {
  return {
    id: movement.id,
    walletId: movement.walletId,
    clientId: movement.clientId,
    toWalletId: movement.toWalletId,
    type: movement.type,
    amount: movement.amount,
    currency: movement.currency,
    exchangeRateId: movement.exchangeRateId,
    description: movement.description,
    date: movement.date,
    createdAt: movement.createdAt,
    updatedAt: movement.updatedAt,
    wallet: movement.wallet
      ? { id: movement.wallet.id, name: movement.wallet.name, currency: movement.wallet.currency }
      : undefined,
    client: movement.client
      ? { id: movement.client.id, name: movement.client.name }
      : undefined,
  }
}
