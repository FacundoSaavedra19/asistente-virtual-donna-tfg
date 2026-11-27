<script setup lang="ts">
/**
 * Historial de conversaciones (GET /api/history).
 *
 * Se monta una sola vez dentro de la pestaña "Historial" y se oculta con
 * v-show, de modo que conserva la lista y no afecta al avatar 3D.
 * Los audios del historial usan un <audio> propio: nunca el de la respuesta
 * actual, para que el avatar no mueva la boca con visemas que no les
 * corresponden.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getHistoryAudioUrl, type DonnaHistoryEntry } from '../services/donnaApi'
import { useDonnaAvatar } from '../composables/useDonnaAvatar'
import { useDonnaHistory } from '../composables/useDonnaHistory'
import { formatDuration, formatHistoryDate } from '../utils/historyFormat'

const props = defineProps<{
  baseUrl: string
  timeoutMs?: number
  demoMode: boolean
  /** true cuando la pestaña del historial está visible. */
  active: boolean
  /** Se incrementa tras cada respuesta nueva de Donna. */
  version: number
}>()

const avatar = useDonnaAvatar()

const { entries, loading, error, loaded, refresh, reset } = useDonnaHistory({
  baseUrl: props.baseUrl,
  timeoutMs: props.timeoutMs,
  demoMode: () => props.demoMode
})

// --- Reproducción independiente --------------------------------------------

const player = ref<HTMLAudioElement | null>(null)
const playingId = ref<number | null>(null)
const audioErrorId = ref<number | null>(null)

function audioUrl(entry: DonnaHistoryEntry): string | null {
  return props.demoMode ? null : getHistoryAudioUrl(entry.archivo_audio, props.baseUrl)
}

function stopPlayback() {
  const el = player.value
  playingId.value = null
  if (!el) return
  el.pause()
  el.removeAttribute('src')
  el.load()
}

async function togglePlay(entry: DonnaHistoryEntry) {
  if (playingId.value === entry.id) {
    stopPlayback()
    return
  }

  const url = audioUrl(entry)
  const el = player.value
  if (!url || !el) return

  // Detiene la respuesta actual: su evento pause pone speaking = false
  // y el avatar vuelve a reposo.
  avatar.audio.value?.pause()

  audioErrorId.value = null
  playingId.value = entry.id
  el.src = url

  try {
    await el.play()
  } catch {
    if (playingId.value === entry.id) onPlayerError()
  }
}

function onPlayerEnded() {
  playingId.value = null
}

function onPlayerError() {
  // Sin src (tras stopPlayback) no es un error del usuario.
  if (playingId.value === null) return
  audioErrorId.value = playingId.value
  stopPlayback()
}

// --- Carga ------------------------------------------------------------------

// Hay que recargar la próxima vez que la pestaña se muestre.
let stale = true

async function load() {
  stale = false
  await refresh()
  if (error.value) stale = true
}

watch(() => props.active, active => {
  if (active && stale) void load()
  if (!active) stopPlayback()
}, { immediate: true })

watch(() => props.version, () => {
  if (props.active) void load()
  else stale = true
})

watch(() => props.demoMode, () => {
  stopPlayback()
  reset()
  stale = true
  if (props.active) void load()
})

const summary = computed(() => {
  if (loading.value) return 'Cargando historial…'
  if (!loaded.value || error.value) return ''
  if (props.demoMode) return 'Historial de demostración'
  const n = entries.value.length
  if (!n) return ''
  return n === 1 ? 'Última interacción' : `Últimas ${n} interacciones`
})

// Si Donna empieza a hablar o el usuario graba, se corta el audio antiguo.
watch([avatar.speaking, avatar.listening], ([speaking, listening]) => {
  if (speaking || listening) stopPlayback()
})

onBeforeUnmount(stopPlayback)
</script>

<template>
  <div class="history" :aria-busy="loading">
    <div class="history-toolbar">
      <p class="history-summary" role="status" aria-live="polite">
        {{ summary }}
      </p>
      <button
        type="button"
        class="history-refresh"
        :disabled="loading"
        @click="load"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"
             stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>
        </svg>
        {{ loading ? 'Actualizando…' : 'Actualizar' }}
      </button>
    </div>

    <div v-if="error" class="history-state history-error" role="alert">
      <p>{{ error }}</p>
      <button type="button" class="history-retry" :disabled="loading" @click="load">
        Reintentar
      </button>
    </div>

    <p
      v-else-if="loaded && !loading && entries.length === 0"
      class="history-state"
    >
      Todavía no hay conversaciones guardadas.
      Haz una pregunta a Donna y aparecerá aquí.
    </p>

    <p
      v-else-if="loading && entries.length === 0"
      class="history-state"
      aria-hidden="true"
    >
      Cargando historial…
    </p>

    <ol
      v-if="entries.length"
      class="history-list"
      aria-label="Interacciones anteriores, de la más reciente a la más antigua"
    >
      <li v-for="entry in entries" :key="entry.id" class="history-item">
        <article :aria-labelledby="`history-date-${entry.id}`">
          <div class="history-meta">
            <time :id="`history-date-${entry.id}`" :datetime="entry.fecha_hora">
              {{ formatHistoryDate(entry.fecha_hora) }}
            </time>
            <span v-if="entry.estado !== 'ok'" class="history-badge">
              Error
            </span>
          </div>

          <p class="history-bubble user">
            <span class="sr-only">Tú: </span>{{ entry.pregunta }}
          </p>
          <p class="history-bubble assistant">
            <span class="sr-only">Donna: </span>{{ entry.respuesta }}
          </p>

          <p v-if="entry.mensaje_error" class="history-error">
            {{ entry.mensaje_error }}
          </p>

          <div class="history-footer">
            <dl class="history-times">
              <div>
                <dt>Transcripción</dt>
                <dd>{{ formatDuration(entry.t_transcripcion_ms) }}</dd>
              </div>
              <div>
                <dt>Síntesis</dt>
                <dd>{{ formatDuration(entry.t_sintesis_ms) }}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>{{ formatDuration(entry.t_total_ms) }}</dd>
              </div>
            </dl>

            <button
              v-if="audioUrl(entry)"
              type="button"
              class="history-play"
              :aria-pressed="playingId === entry.id"
              :aria-label="playingId === entry.id
                ? 'Detener el audio de esta respuesta'
                : 'Escuchar el audio de esta respuesta'"
              @click="togglePlay(entry)"
            >
              <span aria-hidden="true">{{ playingId === entry.id ? '■' : '▶' }}</span>
              {{ playingId === entry.id ? 'Detener' : 'Escuchar' }}
            </button>
          </div>

          <p
            v-if="audioErrorId === entry.id"
            class="history-error history-audio-error"
            role="alert"
          >
            El audio de esta respuesta ya no está disponible.
          </p>
        </article>
      </li>
    </ol>

    <!-- Reproductor propio del historial, separado del audio del avatar. -->
    <audio
      ref="player"
      preload="none"
      @ended="onPlayerEnded"
      @error="onPlayerError"
    />
  </div>
</template>

<style scoped>
.history {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.history-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.history-summary {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

.history-refresh,
.history-retry,
.history-play {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  border-radius: 8px;
  padding: 7px 12px;
  font-size: 12px;
  cursor: pointer;
}

.history-refresh svg {
  width: 14px;
  height: 14px;
}

.history-refresh:hover:not(:disabled),
.history-retry:hover:not(:disabled),
.history-play:hover {
  border-color: var(--accent);
}

.history-refresh:disabled,
.history-retry:disabled {
  opacity: .55;
  cursor: wait;
}

.history-refresh:focus-visible,
.history-retry:focus-visible,
.history-play:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

.history-play[aria-pressed="true"] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}

.history-state {
  margin: 0;
  padding: 18px;
  border: 1px dashed var(--border);
  border-radius: 9px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}

.history-state p {
  margin: 0 0 12px;
}

.history-error {
  color: #ff9da9;
  overflow-wrap: anywhere;
}

/* En los temas claros el rosa no tiene contraste suficiente. */
:global(.donna[data-theme="modern"]) .history-error,
:global(.donna[data-theme="minimal"]) .history-error {
  color: #b3261e;
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0 4px 0 0;
  overflow-y: auto;
  min-height: 0;
  max-height: 480px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.history-item {
  border: 1px solid var(--border);
  border-radius: 11px;
  padding: 14px;
}

.history-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--muted);
  font-size: 12px;
}

.history-badge {
  border-radius: 6px;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 600;
  background: #e87c9a;
  color: #21101a;
}

.history-bubble {
  max-width: 85%;
  margin: 0 0 8px;
  padding: 11px 14px;
  border-radius: 9px;
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.history-bubble.user {
  margin-left: auto;
  width: fit-content;
  background: var(--accent);
  color: var(--accent-text);
}

.history-bubble.assistant {
  width: fit-content;
  background: var(--bubble);
}

.history-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}

.history-times {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.history-times div {
  display: flex;
  gap: 5px;
}

.history-times dt::after {
  content: ':';
}

.history-times dd {
  margin: 0;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.history-audio-error {
  margin: 8px 0 0;
  font-size: 12px;
}
</style>
