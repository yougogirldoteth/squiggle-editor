<script setup lang="ts">
defineProps<{ name: string }>()
const paths: Record<string, string> = {
  undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12',
  redo: 'm15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12',
  shuffle: 'm17 3 4 4-4 4M3 7h3c5 0 7 10 12 10h3m-4-4 4 4-4 4M3 17h3c2 0 3-2 4-4m4-4c1-1 2-2 4-2h3',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  copy: 'M8 8h12v13H8zM16 8V3H3v13h5',
  reverse: 'M3 7h18m-5-5 5 5-5 5M21 17H3m5-5-5 5 5 5',
  play: 'm8 4 12 8-12 8z',
  pause: 'M8 4v16M16 4v16',
  link: 'm10 14 4-4m-6 5-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 2 2-2a4 4 0 0 0-6-6l-4 4a4 4 0 0 0 0 6',
  reset: 'M3 4v6h6M3 10a9 9 0 1 1 1 8',
  spark: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z',
  check: 'm4 12 5 5L20 6',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
}
</script>
<template><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.spark" /></svg></template>
