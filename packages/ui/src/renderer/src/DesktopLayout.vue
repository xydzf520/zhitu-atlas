<template>
  <AtlasShell mode="desktop"
    ><ElAlert v-if="error" :title="error" type="warning" @close="error = ''" />
    <div class="atlas-route-content">
      <RouterView v-slot="{ Component }"
        ><KeepAlive><component :is="Component" /></KeepAlive
      ></RouterView></div
  ></AtlasShell>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ElAlert } from 'element-plus'
import AtlasShell from './components/career/AtlasShell.vue'
const router = useRouter(),
  error = ref('')
const open = (_event: unknown, input: { url: string }) => {
  void router.push({
    path: '/main-layout/CareerBoss',
    query: { url: input.url, request: String(Date.now()) }
  })
}
const fail = (_event: unknown, message: string) => {
  error.value = message
}
onMounted(() => {
  electron.ipcRenderer.on('atlas-boss-open-request', open)
  electron.ipcRenderer.on('atlas-runtime-error', fail)
})
onBeforeUnmount(() => {
  electron.ipcRenderer.removeListener('atlas-boss-open-request', open)
  electron.ipcRenderer.removeListener('atlas-runtime-error', fail)
})
</script>
