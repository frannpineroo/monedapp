import { API_URL } from './config'

type RequestOptions = {
  method?: string
  body?: unknown
  token?: string | null
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Qué hacer cuando el backend rechaza un token que la app creía bueno. Lo registra
 * el AuthProvider; vive acá porque el cliente no puede depender del contexto.
 */
let onUnauthorized: (() => void) | null = null

export function setOnUnauthorized(handler: (() => void) | null) {
  onUnauthorized = handler
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  if (res.status === 204) {
    return undefined as T
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Sólo si el pedido llevaba token: un 401 del login es una contraseña mala,
    // no una sesión vencida.
    if (res.status === 401 && options.token) {
      onUnauthorized?.()
    }
    throw new ApiError(res.status, data.error ?? 'Error de red')
  }
  return data as T
}
