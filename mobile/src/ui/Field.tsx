import { colors, radius, spacing, type } from '@/src/theme'
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
  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Txt variant="label" tone="faint">
          {label}
        </Txt>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.faint}
        selectionColor={colors.brand}
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

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  input: {
    ...type.body,
    backgroundColor: colors.surfaceSunken,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.ink,
    minHeight: 48,
  },
  inputError: { borderColor: colors.attentionEdge },
})
