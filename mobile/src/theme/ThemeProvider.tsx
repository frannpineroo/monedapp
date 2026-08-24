import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { darkColors, lightColors, type Colors } from './palettes'

export type ThemeName = 'dark' | 'light'
/** Lo que el usuario elige. `system` sigue el ajuste del teléfono. */
export type ThemePreference = 'system' | 'dark' | 'light'

const STORAGE_KEY = 'monedapp.theme'

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'dark' || value === 'light'
}

type ThemeValue = {
  /** El tema ya resuelto. Es lo que hay que mirar para pintar. */
  name: ThemeName
  colors: Colors
  preference: ThemePreference
  setPreference: (next: ThemePreference) => void
  /** Verdadero mientras se lee la preferencia del disco. */
  loading: boolean
}

const ThemeContext = createContext<ThemeValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme()
  const [preference, setPreferenceState] = useState<ThemePreference>('system')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (alive && isPreference(stored)) setPreferenceState(stored)
      })
      .catch(() => {
        // Sin preferencia legible se usa 'system', que es el default.
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const setPreference = useCallback((next: ThemePreference) => {
    // El estado se actualiza en el mismo tick: el toggle no espera al disco.
    setPreferenceState(next)
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {})
  }, [])

  // Si el sistema no informa esquema, la app se ve como se veía siempre.
  const name: ThemeName =
    preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference

  const value = useMemo<ThemeValue>(
    () => ({
      name,
      colors: name === 'dark' ? darkColors : lightColors,
      preference,
      setPreference,
      loading,
    }),
    [name, preference, setPreference, loading]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme() fuera de <ThemeProvider>')
  return value
}

export function useThemeColors(): Colors {
  return useTheme().colors
}

/**
 * Caché por (fábrica, tema). Cada `makeStyles` se ejecuta como máximo dos
 * veces en toda la vida de la app, una por tema — no una por componente.
 *
 * Depende de que las fábricas se declaren a nivel de módulo, así su
 * identidad es estable. Lo verifica scripts/check-contrast.mjs.
 */
const stylesCache = new WeakMap<object, Map<ThemeName, unknown>>()

export function useThemeStyles<T>(factory: (c: Colors) => T): T {
  const { name, colors } = useTheme()
  return useMemo(() => {
    let byTheme = stylesCache.get(factory)
    if (!byTheme) {
      byTheme = new Map()
      stylesCache.set(factory, byTheme)
    }
    if (!byTheme.has(name)) byTheme.set(name, factory(colors))
    return byTheme.get(name) as T
  }, [factory, name, colors])
}
