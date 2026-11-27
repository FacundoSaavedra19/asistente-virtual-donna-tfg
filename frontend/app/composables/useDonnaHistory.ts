import { onScopeDispose, ref, toValue, type MaybeRefOrGetter } from 'vue'
import {
  DonnaApiError,
  fetchHistory,
  HISTORY_DEFAULT_LIMIT,
  type DonnaHistoryEntry
} from '../services/donnaApi'

export interface UseDonnaHistoryOptions {
  baseUrl: string
  timeoutMs?: number
  /** Con el modo demostración activo se muestran datos simulados. */
  demoMode: MaybeRefOrGetter<boolean>
  limit?: number
}

/** Interacciones de ejemplo para el modo demostración (sin audio). */
export const DEMO_HISTORY: readonly DonnaHistoryEntry[] = [
  {
    id: 2,
    fecha_hora: '2026-11-27T10:42:10',
    idioma: 'es',
    pregunta: 'Abrir YouTube',
    respuesta: 'Abriendo YouTube',
    comando_id: null,
    archivo_audio: null,
    t_transcripcion_ms: 1320,
    t_sintesis_ms: 410,
    t_total_ms: 1780,
    estado: 'ok',
    mensaje_error: null
  },
  {
    id: 1,
    fecha_hora: '2026-11-27T10:41:02',
    idioma: 'es',
    pregunta: '¿Qué hora es?',
    respuesta: 'Son las 10 horas con 41 minutos',
    comando_id: null,
    archivo_audio: null,
    t_transcripcion_ms: 1840,
    t_sintesis_ms: 620,
    t_total_ms: 2490,
    estado: 'ok',
    mensaje_error: null
  }
]

/**
 * Estado del historial: carga, errores, actualización y cancelación.
 * Cada refresh() cancela la petición anterior; solo la última actualiza
 * el estado, así que no se mezclan respuestas que lleguen desordenadas.
 */
export function useDonnaHistory(options: UseDonnaHistoryOptions) {
  const entries = ref<DonnaHistoryEntry[]>([])
  const loading = ref(false)
  const error = ref('')
  /** true cuando se ha completado al menos una carga (con éxito o error). */
  const loaded = ref(false)

  let controller: AbortController | null = null

  function cancel() {
    controller?.abort()
    controller = null
    loading.value = false
  }

  async function refresh() {
    controller?.abort()
    const current = new AbortController()
    controller = current

    loading.value = true
    error.value = ''

    try {
      const result = toValue(options.demoMode)
        ? DEMO_HISTORY.map(entry => ({ ...entry }))
        : await fetchHistory({
            baseUrl: options.baseUrl,
            timeoutMs: options.timeoutMs,
            limit: options.limit ?? HISTORY_DEFAULT_LIMIT,
            signal: current.signal
          })

      if (controller !== current) return
      entries.value = result
      loaded.value = true
    } catch (err) {
      if (controller !== current) return
      if (err instanceof DonnaApiError && err.kind === 'cancelled') return
      error.value = err instanceof Error
        ? err.message
        : 'No se pudo cargar el historial.'
      loaded.value = true
    } finally {
      if (controller === current) {
        controller = null
        loading.value = false
      }
    }
  }

  /** Vacía la lista (p. ej. al cambiar entre modo demo y modo real). */
  function reset() {
    cancel()
    entries.value = []
    error.value = ''
    loaded.value = false
  }

  onScopeDispose(cancel)

  return { entries, loading, error, loaded, refresh, cancel, reset }
}
