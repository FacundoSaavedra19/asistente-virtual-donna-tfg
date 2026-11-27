// Pruebas del historial (GET /api/history) sin el backend real.
// Las filas imitan el esquema de la tabla `interaccion` de backend/donna/history.py.
// Ejecutar con: npm test
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import {
  DonnaApiError,
  fetchHistory,
  getHistoryAudioUrl,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  normalizeHistoryLimit,
  parseHistory
} from '../app/services/donnaApi.ts'
import {
  formatDuration,
  formatHistoryDate,
  parseHistoryDate
} from '../app/utils/historyFormat.ts'

const BASE = 'http://127.0.0.1:8000'

// Fila tal y como la devuelve `dict(sqlite3.Row)` en History.latest().
const ROW = {
  id: 12,
  fecha_hora: '2026-11-27T18:19:05',
  idioma: 'es',
  pregunta: '¿Qué hora es?',
  respuesta: 'Son las 18 horas con 19 minutos',
  comando_id: null,
  archivo_audio: 'a5544a8c0f3e4b7d9c1e2f3a4b5c6d7e.wav',
  t_transcripcion_ms: 1840,
  t_sintesis_ms: 620,
  t_total_ms: 2490,
  estado: 'ok',
  mensaje_error: null
}

describe('parseHistory', () => {
  test('acepta las filas reales del backend sin cambios', () => {
    assert.deepEqual(parseHistory([ROW]), [ROW])
  })

  test('acepta un historial vacío', () => {
    assert.deepEqual(parseHistory([]), [])
  })

  test('mantiene el orden del backend (más reciente primero)', () => {
    const rows = [{ ...ROW, id: 3 }, { ...ROW, id: 2 }, { ...ROW, id: 1 }]
    assert.deepEqual(parseHistory(rows).map(r => r.id), [3, 2, 1])
  })

  test('acepta null en las columnas opcionales', () => {
    const [entry] = parseHistory([{
      ...ROW,
      archivo_audio: null,
      t_transcripcion_ms: null,
      t_sintesis_ms: null,
      mensaje_error: null
    }])
    assert.equal(entry?.archivo_audio, null)
    assert.equal(entry?.t_transcripcion_ms, null)
    assert.equal(entry?.t_sintesis_ms, null)
  })

  test('conserva estado y mensaje de error', () => {
    const [entry] = parseHistory([{ ...ROW, estado: 'error', mensaje_error: 'Fallo STT' }])
    assert.equal(entry?.estado, 'error')
    assert.equal(entry?.mensaje_error, 'Fallo STT')
  })

  test('descarta filas sin columnas obligatorias o mal formadas', () => {
    const { pregunta: _p, ...sinPregunta } = ROW
    const result = parseHistory([
      ROW,
      sinPregunta,
      { ...ROW, id: '7' },
      { ...ROW, t_total_ms: null },
      null,
      'texto',
      [1, 2]
    ])
    assert.deepEqual(result.map(r => r.id), [12])
  })

  test('normaliza tipos incorrectos de columnas opcionales a null', () => {
    const [entry] = parseHistory([{ ...ROW, t_sintesis_ms: '620', archivo_audio: 5 }])
    assert.equal(entry?.t_sintesis_ms, null)
    assert.equal(entry?.archivo_audio, null)
  })

  test('lanza invalid-response si no es un array', () => {
    for (const raw of [{}, null, 'x', 42, { detail: 'x' }]) {
      assert.throws(() => parseHistory(raw), (err: unknown) => {
        assert.ok(err instanceof DonnaApiError)
        assert.equal(err.kind, 'invalid-response')
        return true
      })
    }
  })
})

describe('normalizeHistoryLimit', () => {
  test('usa 20 por defecto y limita entre 1 y el máximo', () => {
    assert.equal(normalizeHistoryLimit(undefined), HISTORY_DEFAULT_LIMIT)
    assert.equal(normalizeHistoryLimit(NaN), HISTORY_DEFAULT_LIMIT)
    assert.equal(normalizeHistoryLimit('5'), HISTORY_DEFAULT_LIMIT)
    assert.equal(normalizeHistoryLimit(5), 5)
    assert.equal(normalizeHistoryLimit(7.9), 7)
    // Un límite negativo haría que SQLite devolviera todas las filas.
    assert.equal(normalizeHistoryLimit(-1), 1)
    assert.equal(normalizeHistoryLimit(0), 1)
    assert.equal(normalizeHistoryLimit(10_000), HISTORY_MAX_LIMIT)
  })
})

describe('getHistoryAudioUrl', () => {
  test('construye /audio/<archivo> en el origen de la API', () => {
    assert.equal(
      getHistoryAudioUrl(ROW.archivo_audio, BASE),
      `${BASE}/audio/${ROW.archivo_audio}`
    )
  })

  test('devuelve null sin audio o con nombres no seguros', () => {
    for (const name of [
      null,
      '',
      '../donna.db',
      'a/b.wav',
      'a\\b.wav',
      'https://evil.example/x.wav',
      'javascript:alert(1)',
      'audio.exe',
      'sin-extension'
    ]) {
      assert.equal(getHistoryAudioUrl(name, BASE), null, String(name))
    }
  })
})

describe('historyFormat', () => {
  test('parseHistoryDate interpreta el formato del backend como hora local', () => {
    const date = parseHistoryDate('2026-11-27T18:19:05')
    assert.ok(date)
    assert.equal(date.getFullYear(), 2026)
    assert.equal(date.getMonth(), 10)
    assert.equal(date.getDate(), 27)
    assert.equal(date.getHours(), 18)
    assert.equal(date.getMinutes(), 19)
  })

  test('parseHistoryDate rechaza textos que no son fechas', () => {
    assert.equal(parseHistoryDate(''), null)
    assert.equal(parseHistoryDate('ayer'), null)
    assert.equal(parseHistoryDate('2026-13-45T99:99:99'), null)
  })

  test('formatHistoryDate muestra fecha y hora en español', () => {
    const text = formatHistoryDate('2026-11-27T18:19:05')
    assert.match(text, /27/)
    assert.match(text, /nov/i)
    assert.match(text, /2026/)
    assert.match(text, /18:19/)
  })

  test('formatHistoryDate devuelve el texto original si no es válido', () => {
    assert.equal(formatHistoryDate('fecha rara'), 'fecha rara')
  })

  test('formatDuration', () => {
    assert.equal(formatDuration(0), '0 ms')
    assert.equal(formatDuration(850), '850 ms')
    assert.equal(formatDuration(1000), '1,0 s')
    assert.equal(formatDuration(2490), '2,5 s')
    assert.equal(formatDuration(null), '—')
    assert.equal(formatDuration(undefined), '—')
    assert.equal(formatDuration(-5), '—')
    assert.equal(formatDuration(Number.NaN), '—')
  })
})

describe('fetchHistory', () => {
  let server: Server
  let base: string
  let lastUrl: string | undefined
  let lastMethod: string | undefined
  let reply: (url: URL, res: import('node:http').ServerResponse) => void

  before(async () => {
    server = createServer((req, res) => {
      lastUrl = req.url
      lastMethod = req.method
      reply(new URL(req.url ?? '/', 'http://x'), res)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  after(() => {
    server.closeAllConnections()
    server.close()
  })

  const json = (body: unknown, status = 200) =>
    (_url: URL, res: import('node:http').ServerResponse) => {
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(body))
    }

  async function expectKind(promise: Promise<unknown>, kind: string) {
    await assert.rejects(promise, (err: unknown) => {
      assert.ok(err instanceof DonnaApiError)
      assert.equal(err.kind, kind)
      return true
    })
  }

  test('envía GET /api/history?limit=20 por defecto', async () => {
    reply = json([ROW])
    const result = await fetchHistory({ baseUrl: base })
    assert.equal(lastMethod, 'GET')
    assert.equal(lastUrl, '/api/history?limit=20')
    assert.deepEqual(result, [ROW])
  })

  test('envía el límite indicado, normalizado', async () => {
    reply = json([])
    await fetchHistory({ baseUrl: base, limit: 5 })
    assert.equal(lastUrl, '/api/history?limit=5')
    await fetchHistory({ baseUrl: base, limit: -3 })
    assert.equal(lastUrl, '/api/history?limit=1')
  })

  test('historial vacío', async () => {
    reply = json([])
    assert.deepEqual(await fetchHistory({ baseUrl: base }), [])
  })

  test('error 422 de FastAPI con detail en forma de lista', async () => {
    reply = json({ detail: [{ msg: 'Input should be a valid integer' }] }, 422)
    await assert.rejects(fetchHistory({ baseUrl: base }), (err: unknown) => {
      assert.ok(err instanceof DonnaApiError)
      assert.equal(err.kind, 'server')
      assert.equal(err.status, 422)
      assert.match(err.message, /código 422/)
      return true
    })
  })

  test('error 500 con detail de texto', async () => {
    reply = json({ detail: 'database is locked' }, 500)
    await assert.rejects(fetchHistory({ baseUrl: base }), (err: unknown) => {
      assert.ok(err instanceof DonnaApiError)
      assert.equal(err.status, 500)
      assert.equal(err.message, 'database is locked')
      return true
    })
  })

  test('respuesta que no es un array', async () => {
    reply = json({ items: [ROW] })
    await expectKind(fetchHistory({ baseUrl: base }), 'invalid-response')
  })

  test('respuesta que no es JSON', async () => {
    reply = (_url, res) => res.end('<html>no json</html>')
    await expectKind(fetchHistory({ baseUrl: base }), 'invalid-response')
  })

  test('tiempo de espera agotado', async () => {
    reply = () => { /* nunca responde */ }
    await assert.rejects(
      fetchHistory({ baseUrl: base, timeoutMs: 150 }),
      (err: unknown) => {
        assert.ok(err instanceof DonnaApiError)
        assert.equal(err.kind, 'timeout')
        assert.match(err.message, /historial/)
        return true
      }
    )
  })

  test('cancelación desde fuera', async () => {
    reply = () => { /* nunca responde */ }
    const controller = new AbortController()
    const promise = fetchHistory({ baseUrl: base, signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    await expectKind(promise, 'cancelled')
  })

  test('servidor apagado', async () => {
    const off = createServer()
    await new Promise<void>(resolve => off.listen(0, '127.0.0.1', resolve))
    const offBase = `http://127.0.0.1:${(off.address() as AddressInfo).port}`
    await new Promise(resolve => off.close(resolve))
    await expectKind(fetchHistory({ baseUrl: offBase }), 'network')
  })
})
