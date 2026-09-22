<template>
  <button class="atlas-version-button" type="button" aria-haspopup="dialog" :aria-expanded="visible" aria-label="查看版本更新日志" @click="visible = true">
    <span class="atlas-version-edition">{{ ATLAS_EDITION }}<span aria-hidden="true">更新日志 ›</span></span>
    <span class="atlas-version-number">v{{ buildInfo.version }}</span>
  </button>
  <ElDialog v-model="visible" title="版本更新日志" width="min(680px, calc(100vw - 32px))" top="8vh" append-to-body class="atlas-release-dialog">
    <div class="atlas-release-intro">
      <span>{{ PRODUCT_NAME }}</span>
      <span>当前版本 <strong>v{{ buildInfo.version }}</strong></span>
    </div>
    <div class="atlas-release-history" tabindex="0" aria-label="版本更新记录">
      <details v-for="release in ATLAS_RELEASE_NOTES" :key="release.version" :open="release.version === buildInfo.version" class="atlas-release-item">
        <summary>
          <div class="atlas-release-heading"><strong>{{ release.title }}</strong><span v-if="release.version === buildInfo.version" class="atlas-release-current">当前版本</span></div>
          <div class="atlas-release-meta"><span>v{{ release.version }}</span><time :datetime="release.date">{{ release.date }}</time><span class="atlas-release-arrow" aria-hidden="true">⌄</span></div>
        </summary>
        <ul><li v-for="change in release.changes" :key="change">{{ change }}</li></ul>
        <p v-if="release.note" class="atlas-release-note">{{ release.note }}</p>
      </details>
    </div>
    <template #footer><ElButton @click="visible = false">关闭</ElButton></template>
  </ElDialog>
</template>

<script setup lang="ts">
import { inject, ref, watch } from 'vue'
import { ElButton, ElDialog } from 'element-plus'
import { ATLAS_EDITION, PRODUCT_NAME } from '../../../../common/brand'
import { ATLAS_RELEASE_NOTES } from '../../../../common/release-notes'
import buildInfo from '../../../../common/build-info.json'

const visible = ref(false)
const runtime = inject<'desktop' | 'web'>('atlas-runtime', 'web')
watch(visible, value => { if (runtime === 'desktop') void electron.ipcRenderer.invoke('atlas-boss-overlay', value).catch(() => {}) })
</script>

<style scoped>
.atlas-version-button{display:block;width:100%;margin:8px 0 0;padding:9px 8px;border:1px solid var(--el-border-color);border-radius:8px;background:var(--atlas-panel);color:var(--el-text-color-secondary);text-align:left;cursor:pointer;font:inherit;line-height:1.6;transition:background .15s,border-color .15s}
.atlas-version-button:hover{background:var(--el-fill-color-light);border-color:var(--el-color-primary-light-7);color:var(--el-color-primary)}.atlas-version-edition{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:10px}.atlas-version-edition>span{font-size:9px;color:var(--el-color-primary)}.atlas-version-number{display:block;margin-top:3px;font-size:9px;color:var(--el-text-color-secondary);overflow-wrap:anywhere}
.atlas-release-intro{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:0 4px 18px;color:var(--el-text-color-secondary);font-size:12px}.atlas-release-intro strong{font-weight:500;color:var(--el-color-primary)}
.atlas-release-history{max-height:calc(84dvh - 180px);overflow-y:auto;padding:3px 5px;overscroll-behavior:contain}.atlas-release-item{margin-bottom:12px;border:1px solid var(--el-border-color);border-radius:10px;background:var(--el-fill-color-blank)}.atlas-release-item:last-child{margin-bottom:0}.atlas-release-item summary{padding:16px;cursor:pointer;list-style:none;border-radius:10px}.atlas-release-item summary::-webkit-details-marker{display:none}.atlas-release-item summary:hover{background:var(--el-fill-color-light)}
.atlas-release-heading{display:flex;align-items:center;flex-wrap:wrap;gap:10px;color:var(--el-text-color-primary)}.atlas-release-heading strong{font-size:15px;font-weight:600}.atlas-release-current{border-radius:4px;padding:2px 7px;background:var(--el-color-primary-light-9);color:var(--el-color-primary);font-size:10px}.atlas-release-meta{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-top:8px;color:var(--el-text-color-secondary);font-size:11px}.atlas-release-arrow{margin-left:auto}.atlas-release-item[open] .atlas-release-arrow{transform:rotate(180deg)}
.atlas-release-item ul{margin:0;padding:0 22px 16px 34px;font-size:13px;line-height:1.85;color:var(--el-text-color-regular)}.atlas-release-item li+li{margin-top:6px}.atlas-release-note{margin:0 16px 16px;padding:10px 12px;border-left:2px solid var(--el-border-color);background:var(--el-fill-color-light);color:var(--el-text-color-secondary);font-size:12px;line-height:1.75}
</style>
