import { AccountKind, Currency, Prisma } from '@prisma/client'
import { prisma } from '../prisma/prisma'
import { AppError } from '../lib/errors'

export type ProfileTemplate = {
  id: string
  name: string
  description: string
}

const TEMPLATES: ProfileTemplate[] = [
  {
    id: 'freelancer_software',
    name: 'Soy freelancer de software',
    description: 'Ingresos por servicios, billeteras ARS y USD',
  },
  {
    id: 'cursos_online',
    name: 'Vendo cursos online',
    description: 'Ingresos por cursos e infoproductos, billeteras ARS y USD',
  },
]

type AccountSeed = {
  name: string
  kind: AccountKind
  currency?: Currency
  walletName?: string
}

function accountsForTemplate(templateId: string): AccountSeed[] {
  const base: AccountSeed[] = [
    { name: 'Caja ARS', kind: AccountKind.ASSET, currency: Currency.ARS, walletName: 'Efectivo ARS' },
    { name: 'Caja USD', kind: AccountKind.ASSET, currency: Currency.USD, walletName: 'Cuenta USD' },
    { name: 'Gastos operativos', kind: AccountKind.EXPENSE },
    { name: 'Capital', kind: AccountKind.EQUITY },
  ]

  if (templateId === 'freelancer_software') {
    return [...base, { name: 'Ingresos servicios', kind: AccountKind.INCOME }]
  }
  if (templateId === 'cursos_online') {
    return [
      ...base,
      { name: 'Ingresos servicios', kind: AccountKind.INCOME },
      { name: 'Ingresos cursos', kind: AccountKind.INCOME },
    ]
  }
  throw new AppError(400, 'Plantilla desconocida')
}

export function listProfileTemplates(): ProfileTemplate[] {
  return TEMPLATES
}

export async function applyOnboarding(userId: string, templateId: string) {
  const template = TEMPLATES.find((t) => t.id === templateId)
  if (!template) {
    throw new AppError(400, 'Plantilla desconocida')
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  if (user.profileTemplate) {
    throw new AppError(409, 'El onboarding ya fue completado')
  }

  const seeds = accountsForTemplate(templateId)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { profileTemplate: templateId },
    })

    for (const seed of seeds) {
      const account = await tx.account.create({
        data: {
          userId,
          name: seed.name,
          kind: seed.kind,
          currency: seed.currency ?? null,
        },
      })

      if (seed.walletName && seed.currency) {
        await tx.wallet.create({
          data: {
            userId,
            accountId: account.id,
            currency: seed.currency,
            name: seed.walletName,
          },
        })
      }
    }
  })

  return prisma.user.findUniqueOrThrow({ where: { id: userId } })
}

export async function getDefaultIncomeAccountId(
  tx: Prisma.TransactionClient,
  userId: string,
  preferredName?: string
): Promise<string> {
  if (preferredName) {
    const preferred = await tx.account.findFirst({
      where: { userId, kind: AccountKind.INCOME, name: preferredName },
    })
    if (preferred) return preferred.id
  }

  const income = await tx.account.findFirst({
    where: { userId, kind: AccountKind.INCOME },
    orderBy: { createdAt: 'asc' },
  })
  if (!income) throw new AppError(400, 'No hay cuenta de ingresos. Completá el onboarding.')
  return income.id
}

export async function getDefaultExpenseAccountId(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<string> {
  const expense = await tx.account.findFirst({
    where: { userId, kind: AccountKind.EXPENSE },
    orderBy: { createdAt: 'asc' },
  })
  if (!expense) throw new AppError(400, 'No hay cuenta de gastos. Completá el onboarding.')
  return expense.id
}
