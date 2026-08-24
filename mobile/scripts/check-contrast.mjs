/**
 * Verifica los umbrales de contraste del sistema de color y la regla de que
 * toda fábrica `makeStyles` viva en la columna 0.
 *
 * Correr con:  npm run check:contrast   (desde mobile/)
 * Sale con código 1 y lista cada violación si algo no cumple.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { darkColors, lightColors } from '../src/theme/palettes.ts'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

// ---------- utilidades de color ----------

function rgb(hexValue) {
  const h = hexValue.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`hex inválido: ${hexValue}`)
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

function channel(c) {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function luminance(hexValue) {
  const [r, g, b] = rgb(hexValue)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Contraste WCAG 2.1 entre dos colores opacos. */
function ratio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Tono en grados, 0–359. */
function hue(hexValue) {
  const [r, g, b] = rgb(hexValue).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return Math.round((h * 60 + 360) % 360)
}

/** Separación angular más corta entre dos tonos. */
function hueGap(a, b) {
  const d = Math.abs(hue(a) - hue(b))
  return Math.min(d, 360 - d)
}

// ---------- reglas ----------

const failures = []

function expect(label, actual, min) {
  if (actual + 1e-9 < min) {
    failures.push(`${label}: ${actual.toFixed(2)} — mínimo ${min.toFixed(2)}`)
  }
}

/** Texto normal AA. `faint` es la única excepción documentada: 3.0. */
const TEXT_TOKENS = ['ink', 'muted', 'brand', 'positive', 'expense', 'attention']
const ACCENTS = ['brand', 'positive', 'expense', 'attention', 'danger']

function checkTheme(name, c) {
  for (const token of TEXT_TOKENS) {
    expect(`${name}.${token} sobre surface`, ratio(c[token], c.surface), 4.5)
    expect(`${name}.${token} sobre bg`, ratio(c[token], c.bg), 4.5)
  }

  expect(`${name}.faint sobre surface`, ratio(c.faint, c.surface), 3.0)
  expect(`${name}.faint sobre bg`, ratio(c.faint, c.bg), 3.0)

  // danger nunca es texto de cuerpo, salvo el monto rotulado "Excedido".
  expect(`${name}.danger sobre surface`, ratio(c.danger, c.surface), 4.5)

  for (const token of ACCENTS) {
    const tint = `${token}Soft`
    expect(`${name}.${token} sobre ${tint}`, ratio(c[token], c[tint]), 4.5)
    expect(`${name}.${token} no-texto sobre surface`, ratio(c[token], c.surface), 3.0)
  }

  expect(`${name}.onBrand sobre brand`, ratio(c.onBrand, c.brand), 4.5)

  // Los dos rojos del sistema se separan por forma, pero expense y attention
  // sí o sí tienen que verse distintos: es la corrección a D4 del spec.
  const gap = hueGap(c.expense, c.attention)
  if (gap < 20) {
    failures.push(`${name}: expense y attention a ${gap}° de tono — mínimo 20°`)
  }
}

function checkParity() {
  const d = Object.keys(darkColors).sort()
  const l = Object.keys(lightColors).sort()
  const soloDark = d.filter((k) => !l.includes(k))
  const soloLight = l.filter((k) => !d.includes(k))
  if (soloDark.length) failures.push(`tokens solo en dark: ${soloDark.join(', ')}`)
  if (soloLight.length) failures.push(`tokens solo en light: ${soloLight.join(', ')}`)
  if (d.length < 21) failures.push(`la paleta tiene ${d.length} tokens, se esperaban 21`)
}

/** Una fábrica indentada es una fábrica declarada dentro de una función. */
function checkMakeStylesAtColumnZero() {
  const bad = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(full)) continue
      const lines = readFileSync(full, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (/^\s+const make[A-Za-z]*Styles\s*=/.test(line)) {
          bad.push(`${relative(ROOT, full)}:${i + 1}`)
        }
      })
    }
  }
  walk(join(ROOT, 'app'))
  walk(join(ROOT, 'src'))
  for (const location of bad) {
    failures.push(`makeStyles indentado (declarado dentro de una función): ${location}`)
  }
}

// ---------- correr ----------

checkParity()
checkTheme('dark', darkColors)
checkTheme('light', lightColors)
checkMakeStylesAtColumnZero()

if (failures.length) {
  console.error(`\n✗ ${failures.length} violación(es):\n`)
  for (const f of failures) console.error(`  - ${f}`)
  console.error('')
  process.exit(1)
}

console.log('✓ contraste, paridad de tokens y makeStyles: todo en regla')
