import { describe, expect, it } from 'vitest'
import { buildManifest, verifyWebhookSignature } from '../src/services/mercadopago/mpSignature'

const SECRET = 'test-secret'
const TS = '1704908010'
const REQUEST_ID = 'bb56a2f1-6aae-46ac-982e-9dcd3581d08e'
const DATA_ID = '999999999'
const V1 = 'ded680a0c0854e6bb7f4a0a6b627d3e19f1e026b10cdde213c47a4c748d78841'
const V1_SIN_REQUEST_ID = 'a9169cce8d061b7fdc681944c4ace922f52dbe87cdc87e7ebad98b6d1997f159'

describe('mpSignature', () => {
  it('arma el manifiesto con el template exacto de MP', () => {
    expect(buildManifest({ dataId: DATA_ID, requestId: REQUEST_ID, ts: TS })).toBe(
      `id:${DATA_ID};request-id:${REQUEST_ID};ts:${TS};`
    )
  })

  it('omite los pares ausentes en vez de dejarlos vacíos', () => {
    expect(buildManifest({ dataId: DATA_ID, ts: TS })).toBe(`id:${DATA_ID};ts:${TS};`)
  })

  it('firma válida → true', () => {
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${TS},v1=${V1}`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
      })
    ).toBe(true)
  })

  it('data.id en mayúsculas se normaliza y sigue validando', () => {
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${TS},v1=${V1}`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID.toUpperCase(),
        secret: SECRET,
      })
    ).toBe(true)
  })

  it('sin x-request-id usa el manifiesto corto', () => {
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${TS},v1=${V1_SIN_REQUEST_ID}`,
        dataId: DATA_ID,
        secret: SECRET,
      })
    ).toBe(true)
  })

  it('secreto equivocado → false', () => {
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${TS},v1=${V1}`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: 'otro-secreto',
      })
    ).toBe(false)
  })

  it('v1 de largo distinto devuelve false en vez de tirar', () => {
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${TS},v1=abc`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
      })
    ).toBe(false)
  })

  it('header ausente o sin ts → false', () => {
    expect(verifyWebhookSignature({ dataId: DATA_ID, secret: SECRET })).toBe(false)
    expect(
      verifyWebhookSignature({ xSignature: `v1=${V1}`, dataId: DATA_ID, secret: SECRET })
    ).toBe(false)
  })
})
