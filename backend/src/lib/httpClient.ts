export class HttpError extends Error {
  constructor(
    public status: number,
    public body: unknown
  ) {
    super(`HTTP ${status}`)
    this.name = 'HttpError'
  }
}

/** Costura de test: los tests reemplazan `httpClient.fetch` en vez de pisar el global. */
export const httpClient = {
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
}

type RequestOptions = RequestInit & {
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
}

function isRetriable(status: number): boolean {
  return status === 429 || status >= 500
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 10_000, retries = 2, retryDelayMs = 500, ...init } = options
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await httpClient.fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      })

      const text = await res.text()
      let body: unknown = null
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = text
      }

      if (res.ok) return body as T
      const error = new HttpError(res.status, body)
      if (!isRetriable(res.status)) throw error
      lastError = error
    } catch (error) {
      // Un 4xx no se reintenta nunca; los errores de red sí.
      if (error instanceof HttpError && !isRetriable(error.status)) throw error
      lastError = error
    }

    if (attempt < retries) {
      // Backoff con jitter, para no sincronizar reintentos entre usuarios.
      await sleep(retryDelayMs * 2 ** attempt + Math.floor(Math.random() * 100))
    }
  }

  throw lastError
}
