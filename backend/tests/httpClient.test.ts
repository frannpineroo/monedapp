import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError, httpClient, requestJson } from '../src/lib/httpClient'

const realFetch = httpClient.fetch

afterEach(() => {
  httpClient.fetch = realFetch
})

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('requestJson', () => {
  it('devuelve el JSON parseado', async () => {
    httpClient.fetch = vi.fn(async () => jsonResponse(200, { id: 1 })) as typeof fetch

    expect(await requestJson<{ id: number }>('https://mp.test/x')).toEqual({ id: 1 })
  })

  it('reintenta un 500 y devuelve el 200 siguiente', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    httpClient.fetch = fetchMock as unknown as typeof fetch

    expect(await requestJson('https://mp.test/x', { retryDelayMs: 0 })).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('no reintenta un 400 y tira HttpError con el body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(400, { message: 'invalid_grant' }))
    httpClient.fetch = fetchMock as unknown as typeof fetch

    await expect(requestJson('https://mp.test/x', { retryDelayMs: 0 })).rejects.toMatchObject({
      status: 400,
      body: { message: 'invalid_grant' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('agota los reintentos y propaga el último HttpError', async () => {
    httpClient.fetch = vi.fn(async () => jsonResponse(503, {})) as unknown as typeof fetch

    await expect(
      requestJson('https://mp.test/x', { retries: 1, retryDelayMs: 0 })
    ).rejects.toBeInstanceOf(HttpError)
  })
})
