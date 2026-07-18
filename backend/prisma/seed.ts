import 'dotenv/config'
import { Currency, ExchangeRateType, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const STUB: Record<ExchangeRateType, number> = {
  oficial: 980,
  blue: 1280,
  mep: 1210,
}

async function main() {
  const today = new Date()
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))

  for (const currency of [Currency.USD, Currency.USDT] as const) {
    for (const type of Object.values(ExchangeRateType)) {
      await prisma.exchangeRate.upsert({
        where: {
          date_type_currency: { date: d, type, currency },
        },
        create: {
          date: d,
          type,
          currency,
          value: new Prisma.Decimal(STUB[type]),
          source: 'stub',
        },
        update: {
          value: new Prisma.Decimal(STUB[type]),
          source: 'stub',
        },
      })
    }
  }

  for (const type of Object.values(ExchangeRateType)) {
    await prisma.exchangeRate.upsert({
      where: {
        date_type_currency: { date: d, type, currency: Currency.ARS },
      },
      create: {
        date: d,
        type,
        currency: Currency.ARS,
        value: new Prisma.Decimal(1),
        source: 'stub',
      },
      update: {},
    })
  }

  console.log('Seed FX stub OK para', d.toISOString().slice(0, 10))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
