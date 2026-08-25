/**
 * Stub. Existe sólo porque js-tabs necesita una pantalla registrada para
 * dibujar el ícono `+` en la tab bar. Nunca se renderiza: el tabBarButton de
 * (tabs)/_layout.tsx intercepta el toque y navega a /new-movement, que es la
 * ruta de verdad y se presenta como form sheet.
 *
 * El archivo se llama `new` y no `new-movement` a propósito: los segmentos de
 * grupo son transparentes en la URL, así que `(tabs)/new-movement` resolvería
 * al mismo href que `app/new-movement.tsx` y Expo Router elegiría uno de los
 * dos en silencio, sin warning.
 */
export default function NewMovementTabStub() {
  return null
}
