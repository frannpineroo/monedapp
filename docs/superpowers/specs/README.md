# Specs de MonedApp

Un archivo por spec aprobado. Ninguno está implementado todavía. El orden de ejecución y las dependencias entre ellos viven en [IMPLEMENTATION_PLAN.md](../../../IMPLEMENTATION_PLAN.md#roadmap-post-core).

| # | Spec | Tamaño | Estado |
|---|---|---|---|
| 1 | [Cotización real (dolarapi)](01-cotizacion-real-dolarapi.md) | M | Aprobado, sin implementar |
| 2 | [ABM de billeteras y clientes](02-abm-billeteras-clientes.md) | S | Aprobado, sin implementar |
| 3 | [Categorías de gasto y rubros de ingreso](03-categorias.md) | M | Aprobado, sin implementar |
| 4 | [Integración Mercado Pago](04-mercadopago.md) | XL | Aprobado, sin implementar |
| 5 | [Cuentas por cobrar](05-cuentas-por-cobrar.md) | L | Aprobado, sin implementar |
| 6 | [Reportes mensuales + monotributo](06-reportes-monotributo.md) | M/L | Aprobado, sin implementar |
| 7 | [Recalibración de color y tema claro](07-color-y-tema-claro.md) | L | Implementado |
| 8 | [Modal de nuevo movimiento y selects](08-modal-movimiento-y-selects.md) | M | Implementado |

## Convenciones

- Los specs asumen las convenciones del código actual: rutas Express con `asyncHandler` y validación inline que lanza `AppError(400, 'mensaje en español')`, lógica en `backend/src/services/`, respuestas por `backend/src/lib/serializers.ts`, tests con Vitest + Supertest contra Postgres real.
- En la app: Expo Router, `useQuery`/`useMutation` inline por pantalla, y estilos con `useThemeStyles(makeStyles)` leyendo el color del `ThemeProvider` de `mobile/src/theme/`. No existe un `colors` importable. Antes de escribir código de app, leer los docs versionados de Expo SDK 57 (`https://docs.expo.dev/versions/v57.0.0/`), según [mobile/AGENTS.md](../../../mobile/AGENTS.md).
- Cada spec dice explícitamente qué queda fuera de alcance. Si algo no está ni en el spec ni en el backlog del roadmap, no está decidido.
