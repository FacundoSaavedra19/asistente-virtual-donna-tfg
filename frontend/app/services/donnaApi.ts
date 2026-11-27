// Contrato documentado en el README de la rama `backend-fastapi`:
// POST /api/ask (FormData, campo `audio`; webm, m4a, mp3 o wav)
// → { question, answer, audio_url, visemes, action }

export interface DonnaViseme {
  start: number
  end: number
  viseme: string
}

export interface DonnaAction {
  type: string
  url?: string
}

export interface DonnaResponse {
  question?: string
  answer?: string
  audio_url?: string
  visemes?: DonnaViseme[]
  action?: DonnaAction | null
}

export interface DonnaRequestOptions {
  baseUrl: string
  timeoutMs?: number
  signal?: AbortSignal
}

export type DonnaErrorKind =
  | 'timeout'
  | 'cancelled'
  | 'network'
  | 'server'
  | 'invalid-response'

export class DonnaApiError extends Error {
  kind: DonnaErrorKind
  status?: number

  constructor(kind: DonnaErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'DonnaApiError'
    this.kind = kind
    this.status = status
  }
}

const DEFAULT_TIMEOUT_MS = 60000

/**
 * Nombre de archivo con una extensión que admite el backend.
 * Safari graba en audio/mp4, que se envía como .m4a (mismo contenedor).
 */
export function audioFileName(mimeType: string): string {
  const type = mimeType.toLowerCase()

  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) {
    return 'pregunta.m4a'
  }
  if (type.includes('mpeg') || type.includes('mp3')) return 'pregunta.mp3'
  if (type.includes('wav')) return 'pregunta.wav'
  return 'pregunta.webm'
}

async function serverErrorMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json()
    // Formato estándar de errores de FastAPI: { "detail": "..." }
    if (
      typeof data === 'object' && data !== null &&
      typeof (data as { detail?: unknown }).detail === 'string'
    ) {
      return (data as { detail: string }).detail
    }
  } catch {
    // Cuerpo vacío o no JSON: se usa el mensaje genérico.
  }
  return `El servidor no pudo procesar la petición (código ${response.status}).`
}

/**
 * Petición HTTP común a los endpoints JSON: timeout, cancelación externa
 * y traducción de los fallos a DonnaApiError. Devuelve el JSON sin validar.
 */
async function requestJson(
  url: URL,
  init: RequestInit,
  options: DonnaRequestOptions,
  timeoutMessage: string
): Promise<unknown> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  const onExternalAbort = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  options.signal?.addEventListener('abort', onExternalAbort)

  const abortError = () => timedOut
    ? new DonnaApiError('timeout', timeoutMessage)
    : new DonnaApiError('cancelled', 'Petición cancelada.')

  try {
    let response: Response

    try {
      response = await fetch(url, { ...init, signal: controller.signal })
    } catch {
      if (controller.signal.aborted) throw abortError()
      throw new DonnaApiError(
        'network',
        'No se pudo conectar con el servidor de Donna. ' +
        'Comprueba que está en marcha.'
      )
    }

    if (!response.ok) {
      throw new DonnaApiError(
        'server',
        await serverErrorMessage(response),
        response.status
      )
    }

    try {
      return await response.json()
    } catch {
      if (controller.signal.aborted) throw abortError()
      throw invalidResponse()
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onExternalAbort)
  }
}

function invalidResponse(): DonnaApiError {
  return new DonnaApiError(
    'invalid-response',
    'La respuesta del servidor no tiene un formato válido.'
  )
}

export async function askDonna(
  blob: Blob,
  options: DonnaRequestOptions
): Promise<DonnaResponse> {
  const formData = new FormData()
  formData.append('audio', blob, audioFileName(blob.type))

  const data = await requestJson(
    new URL('/api/ask', options.baseUrl),
    { method: 'POST', body: formData },
    options,
    'Donna tarda demasiado en responder. Inténtalo de nuevo.'
  )

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw invalidResponse()
  }

  return data as DonnaResponse
}

// ---------------------------------------------------------------------------
// Historial: GET /api/history?limit=N (backend/main.py y donna/history.py)
// Devuelve un array con las filas de la tabla `interaccion`, de la más
// reciente a la más antigua. Los nombres de los campos son los de SQLite.
// ---------------------------------------------------------------------------

export interface DonnaHistoryEntry {
  id: number
  /** ISO 8601 sin zona horaria, hora local del servidor (p. ej. 2026-11-27T18:19:05). */
  fecha_hora: string
  idioma: string
  pregunta: string
  respuesta: string
  /** Hoy el backend siempre lo guarda como null. */
  comando_id: number | null
  /** Solo el nombre del archivo (sin /audio/). */
  archivo_audio: string | null
  t_transcripcion_ms: number | null
  t_sintesis_ms: number | null
  t_total_ms: number
  /** Hoy siempre "ok": los errores de /api/ask no se registran. */
  estado: string
  mensaje_error: string | null
}

export const HISTORY_DEFAULT_LIMIT = 20
export const HISTORY_MAX_LIMIT = 100

export interface DonnaHistoryOptions extends DonnaRequestOptions {
  limit?: number
}

/** Limita `limit` a un entero entre 1 y HISTORY_MAX_LIMIT. */
export function normalizeHistoryLimit(limit: unknown): number {
  const value = typeof limit === 'number' ? Math.trunc(limit) : NaN
  if (!Number.isFinite(value)) return HISTORY_DEFAULT_LIMIT
  return Math.min(Math.max(value, 1), HISTORY_MAX_LIMIT)
}

function parseHistoryEntry(raw: unknown): DonnaHistoryEntry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>

  const str = (v: unknown) => typeof v === 'string' ? v : null
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null

  const id = num(row.id)
  const fecha = str(row.fecha_hora)
  const pregunta = str(row.pregunta)
  const respuesta = str(row.respuesta)
  const total = num(row.t_total_ms)

  // Columnas NOT NULL del esquema: sin ellas la fila no se puede mostrar.
  if (id === null || fecha === null || pregunta === null ||
      respuesta === null || total === null) {
    return null
  }

  return {
    id,
    fecha_hora: fecha,
    idioma: str(row.idioma) ?? 'es',
    pregunta,
    respuesta,
    comando_id: num(row.comando_id),
    archivo_audio: str(row.archivo_audio),
    t_transcripcion_ms: num(row.t_transcripcion_ms),
    t_sintesis_ms: num(row.t_sintesis_ms),
    t_total_ms: total,
    estado: str(row.estado) ?? 'ok',
    mensaje_error: str(row.mensaje_error)
  }
}

/**
 * Valida la respuesta de /api/history. Lanza DonnaApiError si no es un array
 * y descarta las filas mal formadas en lugar de romper toda la vista.
 */
export function parseHistory(raw: unknown): DonnaHistoryEntry[] {
  if (!Array.isArray(raw)) throw invalidResponse()
  return raw
    .map(parseHistoryEntry)
    .filter((entry): entry is DonnaHistoryEntry => entry !== null)
}

export async function fetchHistory(
  options: DonnaHistoryOptions
): Promise<DonnaHistoryEntry[]> {
  const url = new URL('/api/history', options.baseUrl)
  url.searchParams.set('limit', String(normalizeHistoryLimit(options.limit)))

  const data = await requestJson(
    url,
    { method: 'GET', headers: { Accept: 'application/json' } },
    options,
    'El historial tarda demasiado en cargar. Inténtalo de nuevo.'
  )

  return parseHistory(data)
}

// Nombres generados por el backend: <uuid hex>.wav. Se admite cualquier nombre
// simple con extensión de audio, nunca rutas (/, \, ..).
const HISTORY_AUDIO_NAME = /^[A-Za-z0-9_-]+\.(wav|mp3|m4a|webm|ogg)$/i

/**
 * URL absoluta del audio de una interacción, o null si no tiene audio
 * o el nombre no es seguro. El archivo puede no existir ya en el servidor.
 */
export function getHistoryAudioUrl(
  archivoAudio: string | null,
  baseUrl: string
): string | null {
  if (!archivoAudio || !HISTORY_AUDIO_NAME.test(archivoAudio)) return null
  try {
    return getDonnaAudioUrl(`/audio/${archivoAudio}`, baseUrl)
  } catch {
    return null
  }
}

/** Comprueba GET /health. Devuelve true si el backend responde "ok". */
export async function checkDonnaHealth(
  baseUrl: string,
  timeoutMs = 3000
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(new URL('/health', baseUrl), {
      signal: controller.signal
    })
    if (!response.ok) return false
    const data = await response.json() as { status?: unknown }
    return data?.status === 'ok'
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Devuelve la URL solo si es http(s) y no incluye credenciales.
 * Devuelve null en cualquier otro caso (esquema peligroso, URL mal formada…).
 */
export function parseSafeHttpUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null

  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }

  if (!['http:', 'https:'].includes(url.protocol)) return null
  if (url.username || url.password) return null

  return url
}

/**
 * Resuelve `audio_url` (ruta relativa, p. ej. /audio/xxx.wav) respecto al
 * backend. Solo se admiten URLs http(s) del mismo origen que la API.
 */
export function getDonnaAudioUrl(path: string, baseUrl: string): string {
  const base = new URL(baseUrl)
  let url: URL

  try {
    url = new URL(path, base)
  } catch {
    throw new DonnaApiError('invalid-response', 'La URL del audio no es válida.')
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin) {
    throw new DonnaApiError('invalid-response', 'La URL del audio no es válida.')
  }

  return url.href
}

function parseVisemes(raw: unknown): DonnaViseme[] {
  if (!Array.isArray(raw)) return []

  return raw.filter((item): item is DonnaViseme =>
    typeof item === 'object' && item !== null &&
    Number.isFinite(item.start) &&
    Number.isFinite(item.end) &&
    typeof item.viseme === 'string'
  )
}

export interface DonnaTurn {
  question: string | null
  answer: string | null
  audioUrl: string | null
  visemes: DonnaViseme[]
  openUrl: URL | null
  warnings: string[]
}

/** Convierte la respuesta del backend en datos listos para la interfaz. */
export function interpretDonnaResponse(
  data: DonnaResponse,
  baseUrl: string
): DonnaTurn {
  const warnings: string[] = []
  const text = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null

  const question = text(data.question)
  const answer = text(data.answer)

  let audioUrl: string | null = null
  if (typeof data.audio_url === 'string' && data.audio_url) {
    try {
      audioUrl = getDonnaAudioUrl(data.audio_url, baseUrl)
    } catch {
      warnings.push('No se pudo cargar el audio de la respuesta.')
    }
  }

  let openUrl: URL | null = null
  if (data.action?.type === 'open_url') {
    openUrl = parseSafeHttpUrl(data.action.url)
    if (!openUrl) {
      warnings.push(
        'Donna ha solicitado abrir una dirección no válida y se ha bloqueado.'
      )
    }
  }

  if (!question && !answer) {
    warnings.push('El servidor respondió, pero sin pregunta ni respuesta.')
  }

  return {
    question,
    answer,
    audioUrl,
    visemes: parseVisemes(data.visemes),
    openUrl,
    warnings
  }
}
