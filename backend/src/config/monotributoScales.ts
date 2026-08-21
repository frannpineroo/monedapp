import { Prisma } from '@prisma/client'
import { prisma } from '../prisma/prisma'

/**
 * Escalas vigentes desde el 1/8/2026, "locaciones y prestaciones de servicios".
 * Fuente: afip.gob.ar/monotributo/categorias.asp
 *
 * Para actualizar: agregar un bloque nuevo con otro validFrom y correr el seed.
 * Nunca editar este: es el histórico con el que se calcularon reportes viejos.
 */
export const MONOTRIBUTO_VALID_FROM = new Date(Date.UTC(2026, 7, 1))

export const MONOTRIBUTO_SCALES = [
  { category: 'A', annualGrossLimit: 12009410.45, monthlyFeeServices: 49527.18 },
  { category: 'B', annualGrossLimit: 17595182.74, monthlyFeeServices: 56379.08 },
  { category: 'C', annualGrossLimit: 24670494.31, monthlyFeeServices: 66020.12 },
  { category: 'D', annualGrossLimit: 30628651.43, monthlyFeeServices: 84612.93 },
  { category: 'E', annualGrossLimit: 36028231.33, monthlyFeeServices: 119811.45 },
  { category: 'F', annualGrossLimit: 45151659.41, monthlyFeeServices: 150784.21 },
  { category: 'G', annualGrossLimit: 53995798.87, monthlyFeeServices: 230312.94 },
  { category: 'H', annualGrossLimit: 81924660.37, monthlyFeeServices: 522706.68 },
  { category: 'I', annualGrossLimit: 91699761.9, monthlyFeeServices: 963747.86 },
  { category: 'J', annualGrossLimit: 105012519.2, monthlyFeeServices: 1167299.76 },
  { category: 'K', annualGrossLimit: 126610838.75, monthlyFeeServices: 1614446.04 },
]

/** Idempotente: la corren el seed y también los tests. */
export async function ensureMonotributoScales() {
  for (const scale of MONOTRIBUTO_SCALES) {
    await prisma.monotributoScale.upsert({
      where: {
        category_validFrom: { category: scale.category, validFrom: MONOTRIBUTO_VALID_FROM },
      },
      create: {
        category: scale.category,
        validFrom: MONOTRIBUTO_VALID_FROM,
        annualGrossLimit: new Prisma.Decimal(scale.annualGrossLimit),
        monthlyFeeServices: new Prisma.Decimal(scale.monthlyFeeServices),
      },
      update: {
        annualGrossLimit: new Prisma.Decimal(scale.annualGrossLimit),
        monthlyFeeServices: new Prisma.Decimal(scale.monthlyFeeServices),
      },
    })
  }
}
