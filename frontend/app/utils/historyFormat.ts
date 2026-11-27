// Formato de los datos del historial para la interfaz.
// Funciones puras (sin Vue ni Nuxt) para poder probarlas con node --test.

const LOCALE = 'es-ES'

// Formato que guarda el backend: datetime.now().isoformat(timespec="seconds"),
// sin zona horaria. Se acepta también con fracción de segundo o zona.
const ISO_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/

/**
 * Convierte `fecha_hora` en Date. Sin zona horaria, JavaScript la interpreta
 * como hora local, que coincide con la del servidor cuando ambos corren en
 * el mismo equipo. Devuelve null si el texto no es una fecha válida.
 */
export function parseHistoryDate(value: string): Date | null {
  if (!ISO_LOCAL.test(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

/** "27 nov 2026, 18:19". Si la fecha no es válida, devuelve el texto original. */
export function formatHistoryDate(value: string): string {
  const date = parseHistoryDate(value)
  return date ? dateFormatter.format(date) : value
}

const secondsFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
})

/** 850 → "850 ms"; 2490 → "2,5 s". Sin dato → "—". */
export function formatDuration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${secondsFormatter.format(ms / 1000)} s`
}
