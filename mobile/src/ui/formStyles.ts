import { colors } from '@/src/theme'
import { StyleSheet } from 'react-native'

/**
 * Estilos de formulario compartidos por las pantallas nuevas de ABM.
 * Deuda anotada: login, register, onboarding, movements y new-movement
 * siguen con su copia local — migrarlas queda fuera de este alcance.
 */
export const formStyles = StyleSheet.create({
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.ink,
    fontSize: 14,
  },
  chipTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
  },
})
