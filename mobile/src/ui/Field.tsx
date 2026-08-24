import { radius, spacing, type, useThemeColors, useThemeStyles, type Colors } from '@/src/theme'
import { forwardRef } from 'react'
import { StyleSheet, TextInput, View, type TextInputProps, type StyleProp, type ViewStyle } from 'react-native'
import { Txt } from './Text'

type Props = TextInputProps & {
  label?: string
  hint?: string
  error?: string
  containerStyle?: StyleProp<ViewStyle>
}

export const Field = forwardRef<TextInput, Props>(function Field(
  { label, hint, error, containerStyle, style, ...rest },
  ref
) {
  const styles = useThemeStyles(makeStyles)
  const c = useThemeColors()
  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Txt variant="label" tone="faint">
          {label}
        </Txt>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={c.faint}
        selectionColor={c.brand}
        {...rest}
        style={[styles.input, error ? styles.inputError : null, style]}
      />
      {error ? (
        <Txt variant="caption" tone="danger">
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="caption" tone="faint">
          {hint}
        </Txt>
      ) : null}
    </View>
  )
})

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    container: { gap: spacing.sm },
    input: {
      ...type.body,
      backgroundColor: c.surfaceSunken,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      color: c.ink,
      minHeight: 48,
    },
    inputError: { borderColor: c.danger },
  })
