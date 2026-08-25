import { radius, spacing, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'
import Feather from '@expo/vector-icons/Feather'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { LinkButton } from './Button'
import { Sheet } from './Sheet'
import { Txt } from './Text'

export type SelectOption<T extends string> = {
  value: T
  label: string
  /** Línea secundaria opcional (ej. "USD · Mercado Pago"). */
  meta?: string
}

type Props<T extends string> = {
  label: string
  value: T | null
  options: SelectOption<T>[]
  onChange: (value: T) => void
  /** Qué se muestra sin valor elegido. */
  placeholder?: string
  /** Acción extra al pie de la lista (ej. "Nueva categoría"). */
  footerAction?: { label: string; onPress: () => void }
  error?: string
}

/**
 * El control de elección de la app. Trigger con anatomía de Field —rótulo
 * arriba, valor adentro, chevron a la derecha— y lista vertical en un Sheet.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Elegí…',
  footerAction,
  error,
}: Props<T>) {
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
  const [open, setOpen] = useState(false)

  const selected = options.find((o) => o.value === value) ?? null
  const shown = selected?.label ?? placeholder

  function choose(next: T) {
    onChange(next)
    setOpen(false)
  }

  return (
    <View style={styles.container}>
      <Txt variant="label" tone="faint">
        {label}
      </Txt>

      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="combobox"
        accessibilityLabel={label}
        accessibilityValue={{ text: shown }}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [
          styles.trigger,
          error ? styles.triggerError : null,
          pressed && styles.triggerPressed,
        ]}
      >
        <Txt
          variant="body"
          tone={selected ? 'ink' : 'faint'}
          numberOfLines={1}
          style={styles.triggerLabel}
        >
          {shown}
        </Txt>
        <Feather name="chevron-down" size={18} color={c.faint} />
      </Pressable>

      {error ? (
        <Txt variant="caption" tone="danger">
          {error}
        </Txt>
      ) : null}

      <Sheet visible={open} title={label} onClose={() => setOpen(false)} scroll>
        <View>
          {options.map((option, index) => (
            <Pressable
              key={option.value}
              onPress={() => choose(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: option.value === value }}
              style={({ pressed }) => [
                styles.option,
                index > 0 && styles.optionDivider,
                pressed && styles.optionPressed,
              ]}
            >
              <View style={styles.optionText}>
                <Txt variant="bodyMedium" numberOfLines={1}>
                  {option.label}
                </Txt>
                {option.meta ? (
                  <Txt variant="caption" tone="faint" numberOfLines={1} style={styles.optionMeta}>
                    {option.meta}
                  </Txt>
                ) : null}
              </View>
              {option.value === value ? <Feather name="check" size={18} color={c.brand} /> : null}
            </Pressable>
          ))}

          {footerAction ? (
            <View style={styles.footer}>
              <LinkButton
                label={footerAction.label}
                onPress={() => {
                  // El alta inline se abre en el formulario padre, no acá adentro.
                  setOpen(false)
                  footerAction.onPress()
                }}
              />
            </View>
          ) : null}
        </View>
      </Sheet>
    </View>
  )
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    container: { gap: spacing.sm },
    // Misma anatomía que Field: 48px, hundido, radio md.
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      backgroundColor: c.surfaceSunken,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      minHeight: 48,
    },
    triggerPressed: { backgroundColor: c.surfaceRaised },
    triggerError: { borderColor: c.danger },
    triggerLabel: { flex: 1 },

    // Filas de 52px, sin borde por fila: la caja ya la pone el Sheet.
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingVertical: spacing.md,
      minHeight: 52,
    },
    optionDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    optionPressed: { backgroundColor: c.surfaceRaised },
    optionText: { flex: 1 },
    optionMeta: { marginTop: 2 },

    footer: {
      paddingTop: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
  })
