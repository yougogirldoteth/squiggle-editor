<script setup lang="ts">
import type { SquiggleType } from '~/utils/squiggle'
const props = defineProps<{ type: SquiggleType }>()
const uid = useId()
const path = 'M5 20 C10 4 17 36 23 19 S34 4 40 20 S51 34 57 15'
</script>
<template>
  <svg viewBox="0 0 64 40" fill="none" aria-hidden="true">
    <defs><linearGradient :id="uid"><stop stop-color="#f06862"/><stop offset=".28" stop-color="#e2b844"/><stop offset=".5" stop-color="#71bc75"/><stop offset=".75" stop-color="#5cabc4"/><stop offset="1" stop-color="#aa83d5"/></linearGradient></defs>
    <path v-if="type === 'Pipe'" :d="path" stroke="#363932" stroke-width="8" stroke-linecap="round"/>
    <path :d="path" :stroke="`url(#${uid})`" :stroke-width="type === 'Bold' ? 11 : type === 'Fuzzy' ? 9 : 5" :stroke-dasharray="type === 'Slinky' ? '1 2' : type === 'Ribbed' ? '2 1' : undefined" :opacity="type === 'Fuzzy' ? .45 : 1" stroke-linecap="round"/>
    <path v-if="type === 'Fuzzy'" :d="path" :stroke="`url(#${uid})`" stroke-width="5" stroke-dasharray="1 3" stroke-linecap="round"/>
  </svg>
</template>
