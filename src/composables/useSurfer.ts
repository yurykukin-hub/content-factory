/**
 * Vue 3 composable wrapper for wavesurfer.js v7.
 * Provides reactive audio playback with waveform visualization.
 */

import { ref, onBeforeUnmount, type Ref } from 'vue'
import WaveSurfer from 'wavesurfer.js'

export interface UseSurferOptions {
  /** Waveform color (played portion) */
  waveColor?: string
  /** Waveform color (unplayed portion) */
  progressColor?: string
  /** Cursor color */
  cursorColor?: string
  /** Waveform height in px */
  height?: number
  /** Bar width (0 = continuous wave) */
  barWidth?: number
  /** Bar gap */
  barGap?: number
  /** Bar radius */
  barRadius?: number
}

const DEFAULTS: UseSurferOptions = {
  waveColor: '#e5e7eb',           // gray-200
  progressColor: '#d946ef',       // fuchsia-500 (brand)
  cursorColor: '#a855f7',         // purple-500
  height: 64,
  barWidth: 2,
  barGap: 1,
  barRadius: 2,
}

export function useSurfer(
  containerRef: Ref<HTMLElement | null>,
  options: UseSurferOptions = {},
) {
  const ws = ref<WaveSurfer | null>(null)
  const isPlaying = ref(false)
  const isReady = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)

  const opts = { ...DEFAULTS, ...options }

  function init() {
    if (!containerRef.value || ws.value) return

    ws.value = WaveSurfer.create({
      container: containerRef.value,
      waveColor: opts.waveColor,
      progressColor: opts.progressColor,
      cursorColor: opts.cursorColor,
      height: opts.height,
      barWidth: opts.barWidth,
      barGap: opts.barGap,
      barRadius: opts.barRadius,
      normalize: true,
      interact: true,
    })

    ws.value.on('ready', () => {
      isReady.value = true
      duration.value = ws.value?.getDuration() || 0
    })

    ws.value.on('timeupdate', (time: number) => {
      currentTime.value = time
    })

    ws.value.on('play', () => {
      isPlaying.value = true
    })

    ws.value.on('pause', () => {
      isPlaying.value = false
    })

    ws.value.on('finish', () => {
      isPlaying.value = false
    })
  }

  function load(url: string) {
    if (!containerRef.value) return
    if (!ws.value) init()
    isReady.value = false
    currentTime.value = 0
    duration.value = 0
    ws.value?.load(url)
  }

  function playPause() {
    ws.value?.playPause()
  }

  function stop() {
    ws.value?.stop()
    isPlaying.value = false
    currentTime.value = 0
  }

  function seekTo(progress: number) {
    ws.value?.seekTo(Math.max(0, Math.min(1, progress)))
  }

  function destroy() {
    ws.value?.destroy()
    ws.value = null
    isPlaying.value = false
    isReady.value = false
    currentTime.value = 0
    duration.value = 0
  }

  onBeforeUnmount(() => {
    destroy()
  })

  return {
    wavesurfer: ws,
    isPlaying,
    isReady,
    currentTime,
    duration,
    init,
    load,
    playPause,
    stop,
    seekTo,
    destroy,
  }
}
