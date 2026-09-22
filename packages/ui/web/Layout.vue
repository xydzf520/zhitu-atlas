<template>
  <AtlasShell mode="web">
    <div class="atlas-route-content"><RouterView v-slot="{ Component }"><KeepAlive><component :is="Component" /></KeepAlive></RouterView></div>
  </AtlasShell>
</template>
<script setup lang="ts">
import AtlasShell from '../src/renderer/src/components/career/AtlasShell.vue'
</script>
