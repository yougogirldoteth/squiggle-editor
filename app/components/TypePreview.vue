<script lang="ts">
import { drawSquiggle } from '~/utils/squiggle'

// Cropped source canvases survive component remounts; no remote images are used.
const thumbnailCache = new Map<string, HTMLCanvasElement>()

function thumbnail(hash: string): HTMLCanvasElement | undefined {
  const cached = thumbnailCache.get(hash)
  if (cached) return cached

  const source = document.createElement('canvas')
  source.width = 768
  source.height = 512
  const context = source.getContext('2d', { willReadFrequently: true })
  if (!context) return
  drawSquiggle(context, hash, source.width, source.height, { background: 'transparent', phase: 0 })

  const pixels = context.getImageData(0, 0, source.width, source.height).data
  let left = source.width
  let right = -1
  let top = source.height
  let bottom = -1
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (pixels[(y * source.width + x) * 4 + 3] === 0) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) return

  const cropped = document.createElement('canvas')
  cropped.width = right - left + 1
  cropped.height = bottom - top + 1
  const croppedContext = cropped.getContext('2d')
  if (!croppedContext) return
  croppedContext.drawImage(source, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height)
  thumbnailCache.set(hash, cropped)
  return cropped
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SquiggleType } from '~/utils/squiggle'
import { TYPE_EXAMPLES } from '~/utils/examples'

const props = defineProps<{ type: SquiggleType }>()
const example = computed(() => TYPE_EXAMPLES[props.type])
const canvas = ref<HTMLCanvasElement>()
let observer: ResizeObserver | undefined

function render() {
  if (!canvas.value) return
  const rect = canvas.value.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const source = thumbnail(example.value.hash)
  const context = canvas.value.getContext('2d')
  if (!source || !context) return

  const ratio = Math.min(window.devicePixelRatio || 1, 3)
  canvas.value.width = Math.round(rect.width * ratio)
  canvas.value.height = Math.round(rect.height * ratio)
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  const scale = Math.min(Math.max(1, rect.width - 4) / source.width, Math.max(1, rect.height - 4) / source.height)
  const width = source.width * scale
  const height = source.height * scale
  context.drawImage(source, (rect.width - width) / 2, (rect.height - height) / 2, width, height)
}

watch(() => props.type, render, { flush: 'post' })
onMounted(() => {
  render()
  observer = new ResizeObserver(render)
  observer.observe(canvas.value!)
  window.addEventListener('resize', render)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', render)
})
</script>

<template>
  <canvas ref="canvas" class="type-preview" width="64" height="40" aria-hidden="true" :title="'Chromie Squiggle #' + example.tokenId + ' by Snowfro'" />
</template>

<style>
.type-preview {
  display: block;
  width: 64px;
  height: 40px;
  flex-shrink: 0;
  pointer-events: none;
}
</style>
