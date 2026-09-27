<script setup lang="ts">
defineProps<{ src: string; background: string }>()
</script>

<template>
  <div :style="{ width: '1200px', height: '630px', display: 'flex', alignItems: 'center', justifyContent: 'center', background }">
    <img :src="src" width="945" height="630" style="width: 945px; height: 630px;" alt="" />
  </div>
</template>
