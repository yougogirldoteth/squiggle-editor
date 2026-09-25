<script setup lang="ts">
defineProps<{
  id: string
  label: string
  value: number
  display: string
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  spectrum?: boolean
  grayscale?: boolean
  title?: string
}>()
defineEmits<{ start: []; change: [value: number]; end: [] }>()
</script>
<template>
  <div class="range-control" :title="title">
    <label :for="id">{{ label }} <output :for="id">{{ display }}</output></label>
    <input :id="id" :aria-label="label" type="range" :min="min ?? 0" :max="max ?? 255" :step="step ?? 1" :value="value" :disabled="disabled" :class="{ spectrum, grayscale }" @pointerdown="$emit('start')" @keydown="$emit('start')" @input="$emit('change', Number(($event.target as HTMLInputElement).value))" @change="$emit('end')" @blur="$emit('end')">
  </div>
</template>
