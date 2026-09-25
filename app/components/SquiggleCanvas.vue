<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import { buildGeometry, decodeHash, dragCurve, drawSquiggle, nearestCurvePoint, setByte } from '~/utils/squiggle'

const props = withDefaults(defineProps<{
  hash: string
  background: string
  playing: boolean
  speed?: number
  selectedPoint?: number
  showPoints?: boolean
}>(), { speed: 1, showPoints: false })

const emit = defineEmits<{
  'update:hash': [hash: string]
  'gesture-start': []
  'gesture-end': []
  'select-point': [index: number]
}>()

const host = ref<HTMLDivElement>()
const canvas = ref<HTMLCanvasElement>()
const width = ref(0)
const height = ref(0)
const renderHash = shallowRef(props.hash)
const hovered = ref(false)
const focused = ref(false)
const dragging = ref(false)
const selectedControl = ref(props.selectedPoint ?? 0)
const instructionsId = useId()

const geometry = computed(() => width.value > 0 && height.value > 0
  ? buildGeometry(renderHash.value, width.value, height.value)
  : null)
const controls = computed(() => geometry.value?.controls ?? [])
const selection = computed(() => controls.value[Math.min(selectedControl.value, controls.value.length - 1)])
const showGuides = computed(() => props.showPoints || hovered.value || focused.value || dragging.value)
const selectionAnnouncement = computed(() => {
  if (!focused.value || !selection.value) return ''
  return `Point ${selectedControl.value + 1} of ${controls.value.length}, value ${decodeHash(renderHash.value).bytes[selection.value.byteIndex]}.`
})

interface PointerGesture {
  pointerId: number
  startHash: string
  startClientY: number
  width: number
  height: number
  segment: number
  t: number
  pointByteIndex: number | null
  pixelsPerByte: number
}

let pointerGesture: PointerGesture | null = null
let keyboardStartHash: string | null = null
let resizeObserver: ResizeObserver | undefined
let frame: number | null = null
let previousFrame: number | null = null
let phase = 0
let pixelRatio = 1
let mounted = false

function requestDraw() {
  if (mounted && frame === null) frame = requestAnimationFrame(drawFrame)
}

function drawFrame(timestamp: number) {
  frame = null
  const animated = props.playing && !pointerGesture && keyboardStartHash === null
  if (animated && previousFrame !== null) phase += Math.min(timestamp - previousFrame, 80) * 0.06 * props.speed
  previousFrame = animated ? timestamp : null

  const context = canvas.value?.getContext('2d')
  if (context && width.value > 0 && height.value > 0) {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    drawSquiggle(context, renderHash.value, width.value, height.value, {
      background: props.background,
      phase,
    })
    if (animated) requestDraw()
  }
}

function updateHash(hash: string) {
  if (hash === renderHash.value) return
  renderHash.value = hash
  emit('update:hash', hash)
  requestDraw()
}

function selectControl(index: number) {
  selectedControl.value = Math.max(0, Math.min(controls.value.length - 1, Math.round(index)))
  emit('select-point', selectedControl.value)
}

function chooseClosestControl(x: number) {
  let closest = 0
  let distance = Infinity
  for (let i = 0; i < controls.value.length; i++) {
    const candidate = Math.abs(controls.value[i]!.x - x)
    if (candidate < distance) {
      distance = candidate
      closest = i
    }
  }
  selectControl(closest)
}

function controlAtPoint(x: number, y: number) {
  if (!props.showPoints) return null
  let closest: { index: number; byteIndex: number; distance: number } | null = null
  for (const [index, control] of controls.value.entries()) {
    const distance = Math.hypot(control.x - x, control.y - y)
    if (distance <= 18 && (!closest || distance < closest.distance)) closest = { index, byteIndex: control.byteIndex, distance }
  }
  return closest
}

function eventPoint(event: PointerEvent) {
  const rect = canvas.value!.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function onPointerDown(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || pointerGesture || !canvas.value || !geometry.value) return
  finishKeyboardGesture()
  const point = eventPoint(event)
  const handle = controlAtPoint(point.x, point.y)
  const nearest = handle ? null : nearestCurvePoint(renderHash.value, width.value, height.value, point.x, point.y)
  if (!handle && nearest!.distance > Math.max(28, geometry.value.pickRadius)) return

  event.preventDefault()
  canvas.value.focus({ preventScroll: true })
  canvas.value.setPointerCapture(event.pointerId)
  pointerGesture = {
    pointerId: event.pointerId,
    startHash: renderHash.value,
    startClientY: event.clientY,
    width: width.value,
    height: height.value,
    segment: nearest?.segment ?? 0,
    t: nearest?.t ?? 0,
    pointByteIndex: handle?.byteIndex ?? null,
    pixelsPerByte: 2 * geometry.value.squigH / geometry.value.traits.ht / 255,
  }
  if (handle) selectControl(handle.index)
  else chooseClosestControl(nearest!.x)
  dragging.value = true
  previousFrame = null
  emit('gesture-start')
  requestDraw()
}

function onPointerMove(event: PointerEvent) {
  if (pointerGesture) {
    if (event.pointerId !== pointerGesture.pointerId) return
    event.preventDefault()
    const gesture = pointerGesture
    const deltaY = event.clientY - gesture.startClientY
    if (gesture.pointByteIndex !== null) {
      const value = decodeHash(gesture.startHash).bytes[gesture.pointByteIndex]!
      updateHash(setByte(gesture.startHash, gesture.pointByteIndex, value + deltaY / gesture.pixelsPerByte))
    } else {
      updateHash(dragCurve(gesture.startHash, gesture.width, gesture.height, gesture.segment, gesture.t, deltaY))
    }
    return
  }
  if (event.pointerType === 'touch' || !canvas.value || !geometry.value) return
  const point = eventPoint(event)
  const handle = controlAtPoint(point.x, point.y)
  if (handle) {
    hovered.value = true
    if (!focused.value) selectControl(handle.index)
    return
  }
  const nearest = nearestCurvePoint(renderHash.value, width.value, height.value, point.x, point.y)
  hovered.value = nearest.distance <= Math.max(28, geometry.value.pickRadius)
  if (hovered.value && !focused.value) chooseClosestControl(nearest.x)
}

function finishPointerGesture(cancel = false) {
  if (!pointerGesture) return
  const gesture = pointerGesture
  pointerGesture = null
  dragging.value = false
  if (cancel) updateHash(gesture.startHash)
  if (canvas.value?.hasPointerCapture(gesture.pointerId)) canvas.value.releasePointerCapture(gesture.pointerId)
  previousFrame = null
  emit('gesture-end')
  requestDraw()
}

function onPointerUp(event: PointerEvent) {
  if (event.pointerId === pointerGesture?.pointerId) finishPointerGesture()
}

function onPointerCancel(event: PointerEvent) {
  if (event.pointerId === pointerGesture?.pointerId) finishPointerGesture(true)
}

function finishKeyboardGesture(cancel = false) {
  if (keyboardStartHash === null) return
  const startHash = keyboardStartHash
  keyboardStartHash = null
  if (cancel) updateHash(startHash)
  previousFrame = null
  emit('gesture-end')
  requestDraw()
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (pointerGesture || keyboardStartHash !== null) {
      event.preventDefault()
      event.stopPropagation()
      finishPointerGesture(true)
      finishKeyboardGesture(true)
    }
    return
  }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  if (pointerGesture || !controls.value.length) return

  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    finishKeyboardGesture()
    const step = event.key === 'ArrowLeft' ? -1 : 1
    selectControl(selectedControl.value + step)
    return
  }

  if (keyboardStartHash === null) {
    keyboardStartHash = renderHash.value
    previousFrame = null
    emit('gesture-start')
  }
  const index = selection.value!.byteIndex
  const step = (event.key === 'ArrowUp' ? -1 : 1) * (event.shiftKey ? 8 : 1)
  updateHash(setByte(renderHash.value, index, decodeHash(renderHash.value).bytes[index]! + step))
}

function onKeyUp(event: KeyboardEvent) {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') finishKeyboardGesture()
}

function onFocus() {
  focused.value = true
}

function onBlur() {
  focused.value = false
  finishKeyboardGesture()
}

function onWindowBlur() {
  finishPointerGesture(true)
  finishKeyboardGesture()
}

function resizeCanvas() {
  if (!host.value || !canvas.value) return
  const rect = host.value.getBoundingClientRect()
  const nextWidth = rect.width
  const nextHeight = rect.height
  const nextRatio = Math.min(window.devicePixelRatio || 1, 3)
  if (nextWidth === width.value && nextHeight === height.value && nextRatio === pixelRatio) return
  finishPointerGesture(true)
  width.value = nextWidth
  height.value = nextHeight
  pixelRatio = nextRatio
  canvas.value.width = Math.max(1, Math.round(nextWidth * pixelRatio))
  canvas.value.height = Math.max(1, Math.round(nextHeight * pixelRatio))
  requestDraw()
}

function resetPhase() {
  phase = 0
  previousFrame = null
  requestDraw()
}

function exportPng() {
  if (!mounted || width.value <= 0 || height.value <= 0) return
  const output = document.createElement('canvas')
  output.width = Math.round(width.value * 2)
  output.height = Math.round(height.value * 2)
  const context = output.getContext('2d')
  if (!context) return
  context.scale(2, 2)
  drawSquiggle(context, renderHash.value, width.value, height.value, { background: props.background, phase })
  output.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'squiggle.png'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'image/png')
}

watch(() => props.hash, (hash) => {
  renderHash.value = hash
  const clamped = Math.min(selectedControl.value, Math.max(0, controls.value.length - 1))
  if (clamped !== selectedControl.value) selectControl(clamped)
  requestDraw()
})
watch(() => props.selectedPoint, (index) => {
  if (index === undefined) return
  const clamped = Math.max(0, Math.min(controls.value.length - 1, Math.round(index)))
  selectedControl.value = clamped
  if (clamped !== index) emit('select-point', clamped)
})
watch(() => [props.background, props.playing, props.speed], () => {
  previousFrame = null
  requestDraw()
})

onMounted(() => {
  mounted = true
  resizeCanvas()
  resizeObserver = new ResizeObserver(resizeCanvas)
  if (host.value) resizeObserver.observe(host.value)
  window.addEventListener('resize', resizeCanvas)
  window.addEventListener('blur', onWindowBlur)
  selectControl(props.selectedPoint ?? Math.floor(controls.value.length / 2))
  requestDraw()
})

onBeforeUnmount(() => {
  mounted = false
  resizeObserver?.disconnect()
  window.removeEventListener('resize', resizeCanvas)
  window.removeEventListener('blur', onWindowBlur)
  if (frame !== null) cancelAnimationFrame(frame)
  finishPointerGesture(true)
  finishKeyboardGesture()
})

defineExpose({ exportPng, resetPhase })
</script>

<template>
  <div ref="host" class="squiggle-canvas" :class="{ 'is-dragging': dragging, 'is-hovered': hovered }">
    <canvas
      ref="canvas"
      class="squiggle-canvas__art"
      tabindex="0"
      role="application"
      aria-label="Squiggle canvas"
      :aria-describedby="instructionsId"
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Escape"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @lostpointercapture="onPointerCancel"
      @pointerleave="hovered = false"
      @keydown="onKeyDown"
      @keyup="onKeyUp"
      @focus="onFocus"
      @blur="onBlur"
      @contextmenu.prevent
    />
    <svg v-if="showGuides && geometry" class="squiggle-canvas__guides" :viewBox="`0 0 ${width} ${height}`" aria-hidden="true">
      <g v-if="selection" class="squiggle-canvas__rail">
        <path :d="`M ${selection.x} ${selection.y - 23} v 46`" class="squiggle-canvas__rail-halo" />
        <path :d="`M ${selection.x} ${selection.y - 23} v 46`" />
        <path :d="`M ${selection.x - 3} ${selection.y - 19} l 3 -4 l 3 4 M ${selection.x - 3} ${selection.y + 19} l 3 4 l 3 -4`" />
      </g>
      <circle
        v-for="(control, index) in controls"
        :key="control.byteIndex"
        :cx="control.x"
        :cy="control.y"
        :r="index === selectedControl ? 5 : 3"
        :class="{ 'is-selected': index === selectedControl }"
      />
    </svg>
    <p :id="instructionsId" class="squiggle-canvas__sr-only">Drag the curve up or down. Control points stay evenly spaced. Use Left and Right to select a point, then Up and Down to move it. Hold Shift for larger changes. Escape cancels a drag.</p>
    <span class="squiggle-canvas__sr-only" aria-live="polite" aria-atomic="true">{{ selectionAnnouncement }}</span>
  </div>
</template>

<style scoped>
.squiggle-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: inherit;
  isolation: isolate;
}

.squiggle-canvas__art {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  outline: none;
}

.squiggle-canvas__art:focus-visible {
  outline: 2px solid var(--accent, #5e6a57);
  outline-offset: -4px;
}

.is-hovered .squiggle-canvas__art { cursor: ns-resize; }
.is-dragging .squiggle-canvas__art { cursor: grabbing; }

.squiggle-canvas__guides {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.squiggle-canvas__guides circle {
  fill: #fff;
  fill-opacity: 0.82;
  stroke: #272725;
  stroke-width: 1;
  opacity: 0.65;
}

.squiggle-canvas__guides circle.is-selected {
  opacity: 1;
  stroke-width: 1.5;
}

.squiggle-canvas__rail {
  fill: none;
  stroke: #272725;
  stroke-width: 1;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.squiggle-canvas__rail-halo { stroke: #fff; stroke-width: 3; }

.squiggle-canvas__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
</style>
