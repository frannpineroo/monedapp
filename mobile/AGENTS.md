# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# El color viene del contexto, nunca de un import

No existe `import { colors } from '@/src/theme'`. El color se lee con
`useThemeColors()` o `useThemeStyles(makeStyles)`, y toda fábrica
`makeStyles` se declara en la columna 0, nunca dentro de un componente.
`npm run check:contrast` lo verifica.
