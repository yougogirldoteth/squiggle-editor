<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { fitStroke, type StrokePoint } from '~/utils/fitStroke'

const props = defineProps<{ hash: string; background: string }>()
const emit = defineEmits<{ fit: [hash: string]; close: []; notice: [message: string] }>()
const host = ref<HTMLDivElement>()
const instructionsId = useId()
const line = ref('')
const comparison = ref('')
const fitted = ref(false)
const drawing = ref(false)
let gesture: { pointerId: number; hash: string; bounds: DOMRect; points: StrokePoint[] } | null = null
let frame: number | undefined
let comparisonTimer: ReturnType<typeof setTimeout> | undefined
let observer: ResizeObserver | undefined
let expectedHash: string | undefined
let lastSize = ''

const coordinates = (points: StrokePoint[]) => points.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')

function clearComparison() {
  clearTimeout(comparisonTimer)
  comparison.value = ''
}
function release() {
  const pointerId = gesture?.pointerId
  gesture = null
  drawing.value = false
  if (frame !== undefined) cancelAnimationFrame(frame)
  frame = undefined
  line.value = ''
  if (pointerId !== undefined && host.value?.hasPointerCapture(pointerId)) host.value.releasePointerCapture(pointerId)
}
function cancel() { release(); clearComparison() }
function addPoint(event: PointerEvent) {
  if (!gesture) return
  const { bounds, points } = gesture
  const point = { x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)), y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)) }
  const previous = points.at(-1)
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.5) return
  // Long stylus strokes stay bounded without truncating the end of the line.
  if (points.length >= 4096) gesture.points = points.filter((_, i) => i % 2 === 0)
  gesture.points.push(point)
}
function paint() {
  frame = undefined
  if (gesture) line.value = coordinates(gesture.points)
}
function start(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || gesture || !host.value) return
  event.preventDefault()
  clearComparison()
  fitted.value = false
  drawing.value = true
  host.value.focus({ preventScroll: true })
  gesture = { pointerId: event.pointerId, hash: props.hash, bounds: host.value.getBoundingClientRect(), points: [] }
  host.value.setPointerCapture(event.pointerId)
  addPoint(event)
  paint()
}
function move(event: PointerEvent) {
  if (event.pointerId !== gesture?.pointerId) return
  event.preventDefault()
  const events = event.getCoalescedEvents?.()
  for (const sample of events?.length ? events : [event]) addPoint(sample)
  if (frame === undefined) frame = requestAnimationFrame(paint)
}
function finish(event: PointerEvent) {
  if (event.pointerId !== gesture?.pointerId) return
  event.preventDefault()
  addPoint(event)
  const stroke = gesture
  release()
  if (props.hash !== stroke.hash) return
  const fit = fitStroke(stroke.hash, stroke.points, stroke.bounds.width, stroke.bounds.height)
  if (!fit) { emit('notice', 'Draw a wider line to fit a Squiggle.'); return }
  expectedHash = fit.hash
  fitted.value = true
  comparison.value = coordinates(fit.guide)
  comparisonTimer = setTimeout(() => { comparison.value = '' }, 1800)
  emit('fit', fit.hash)
}
function interrupted(event: PointerEvent) {
  if (event.pointerId === gesture?.pointerId) cancel()
}
function outside(event: PointerEvent) {
  if (event.isPrimary && host.value && !event.composedPath().includes(host.value)) cancel()
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (gesture) cancel()
    else emit('close')
  } else if (gesture && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    // An unfinished stroke is not in hash history yet. Undo cancels just that
    // stroke; the next Undo can reach the last completed artwork edit.
    event.preventDefault()
    event.stopImmediatePropagation()
    cancel()
  }
}
watch(() => props.hash, hash => {
  if (hash !== expectedHash) cancel()
  expectedHash = undefined
}, { flush: 'sync' })
watch(() => props.background, cancel)

onMounted(() => {
  host.value?.focus({ preventScroll: true })
  observer = new ResizeObserver(([entry]) => {
    if (!entry) return
    const size = `${entry.contentRect.width}:${entry.contentRect.height}`
    if (lastSize && size !== lastSize) cancel()
    lastSize = size
  })
  if (host.value) observer.observe(host.value)
  window.addEventListener('blur', cancel)
  window.addEventListener('pointerdown', outside, true)
})
onBeforeUnmount(() => {
  cancel()
  observer?.disconnect()
  window.removeEventListener('blur', cancel)
  window.removeEventListener('pointerdown', outside, true)
})
</script>

<template>
  <div
    ref="host" class="draw-overlay" :class="{ 'is-fitted': fitted, 'is-drawing': drawing }"
    :style="{ '--draw-paper': background, '--draw-ink': background === '#000000' || Number.parseInt(background.slice(1, 3), 16) < 125 ? '#ffffff' : '#394431' }"
    role="application" aria-label="Draw a squiggle" :aria-describedby="instructionsId" tabindex="0"
    @pointerdown="start" @pointermove="move" @pointerup="finish"
    @pointercancel="interrupted" @lostpointercapture="interrupted" @contextmenu.prevent @keydown="keydown"
  >
    <div class="draw-paper" />
    <svg aria-hidden="true" class="draw-lines">
      <polyline v-if="line" class="draw-stroke" :points="line" />
      <polyline v-if="comparison" class="draw-comparison" :points="comparison" />
    </svg>
    <p :id="instructionsId" class="draw-hint">{{ fitted ? 'Draw again, or tap Draw to finish.' : 'Draw a line. Release to fit.' }}</p>
    <span class="sr-only" role="status">{{ fitted ? 'Drawing fitted. One undo step. The drawn line is scaled and centered; loops are approximated.' : 'Draw with a mouse, finger or pen. Escape cancels the stroke, or closes Draw mode.' }}</span>
  </div>
</template>

<style scoped>
.draw-overlay { position: absolute; inset: 0; cursor: crosshair; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; outline: none; color: var(--draw-ink); }
.draw-paper { position: absolute; inset: 0; background: var(--draw-paper); opacity: .9; transition: opacity 160ms ease; pointer-events: none; }
.is-fitted .draw-paper { opacity: 0; }
.draw-lines { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: hidden; }
.draw-lines polyline { fill: none; stroke: var(--draw-ink); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.draw-lines .draw-comparison { stroke-width: 1.5; stroke-dasharray: 3 4; animation: drawing-fades 1800ms ease both; }
.draw-hint { position: absolute; top: 12px; left: 12px; right: 12px; margin: 0; text-align: center; font-size: 11px; line-height: 1.5; opacity: .7; pointer-events: none; }
.is-drawing .draw-hint { opacity: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
@keyframes drawing-fades { 0%, 55% { opacity: .6; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .draw-lines .draw-comparison { animation: none; opacity: .5; } }
</style>
