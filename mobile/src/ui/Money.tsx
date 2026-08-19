import { StyleSheet, View } from 'react-native'
import { Txt, type Tone } from './Text'

function group(value: string | number) {
  return Number(value).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

type MoneyProps = {
  value: string | number
  /** Antepone + o - según el signo del valor. */
  signed?: boolean
  /** Fuerza el signo (los gastos se guardan en positivo). */
  sign?: '+' | '-'
  variant?: 'amount' | 'amountLarge' | 'display'
  tone?: Tone
}

/** Número solo, en cifras tabulares. La moneda va aparte, como en un libro contable. */
export function Money({ value, signed, sign, variant = 'amount', tone = 'ink' }: MoneyProps) {
  const n = Number(value)
  const prefix = sign ?? (signed ? (n < 0 ? '-' : '+') : '')
  return (
    <Txt variant={variant} tone={tone} align="right">
      {prefix}
      {group(Math.abs(n))}
    </Txt>
  )
}

/** Celda de la columna de montos: número arriba, código de moneda debajo. */
export function LedgerCell({
  value,
  currency,
  signed,
  sign,
  tone = 'ink',
  variant = 'amount',
}: MoneyProps & { currency: string }) {
  return (
    <View style={styles.cell}>
      <Money value={value} signed={signed} sign={sign} variant={variant} tone={tone} />
      <Txt variant="label" tone="faint" align="right" style={styles.currency}>
        {currency}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  cell: { alignItems: 'flex-end', minWidth: 92 },
  currency: { marginTop: 3 },
})
