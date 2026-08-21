import 'dotenv/config'
import { Currency } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { getRates } from '../src/services/exchangeRateService'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const today = new Date()
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))

  for (const currency of [Currency.USD, Currency.USDT] as const) {
    const rates = await getRates(currency, d)
    for (const rate of rates) {
      const estimada = rate.source === 'stub' || rate.source === 'db-fallback'
      console.log(
        `${currency} ${rate.type}: ${rate.value} (${rate.source})${estimada ? ' — estimada' : ''}`
      )
    }
  }

  await getRates(Currency.ARS, d)

  const { ensureMonotributoScales } = await import('../src/config/monotributoScales')
  await ensureMonotributoScales()
  console.log('Escalas de monotributo cargadas')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
