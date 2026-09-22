<template>
  <div class="structured-text">
    <div v-if="source?.trim() && !hideToolbar" class="reading-toolbar">
      <span>{{ sections.filter((s) => s.blocks.length).length }} 个段落分区 · 按原文排版</span>
      <div>
        <button :aria-expanded="raw" @click="raw = !raw">
          {{ raw ? '返回分区阅读' : '查看原文' }}</button
        ><button @click="copy">复制原文</button>
      </div>
    </div>
    <p v-if="!source?.trim()" class="reading-empty">{{ empty || '暂无正文，等待补充。' }}</p>
    <pre v-else-if="raw" class="reading-original">{{ source }}</pre>
    <div v-else class="reading-sections">
      <section
        v-for="(section, index) in sections.filter((s) => s.blocks.length || s.title !== '正文')"
        :key="index"
        class="reading-section"
      >
        <h4>{{ section.title }}</h4>
        <div class="reading-blocks" role="list">
          <div
            v-for="(block, i) in section.blocks"
            :key="i"
            :class="['reading-block', block.kind]"
            role="listitem"
          >
            <span v-if="block.kind === 'item'" class="reading-marker" aria-hidden="true">{{
              block.marker
            }}</span>
            <p>{{ block.text }}</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { structureText } from '../../../../common/structured-output'
const props = defineProps<{
  source?: string
  empty?: string
  mode?: 'job' | 'resume'
  hideToolbar?: boolean
}>()
const raw = ref(false)
const sections = computed(() => structureText(props.source || '', props.mode))
async function copy() {
  try {
    await electron.ipcRenderer.invoke('career-copy-text', props.source || '')
    ElMessage.success('已复制完整原文')
  } catch {
    ElMessage.error('复制失败，请切换原文后选中复制')
  }
}
</script>
<style scoped>
.structured-text {
  width: 100%;
  min-width: 0;
  color: var(--el-text-color-primary);
}
.reading-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-bottom: 18px;
}
.reading-toolbar div {
  display: flex;
  gap: 14px;
}
.reading-toolbar button {
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  padding: 4px 0;
  cursor: pointer;
  font: inherit;
}
.reading-sections {
  display: grid;
  gap: 22px;
}
.reading-section h4 {
  margin: 0 0 12px;
  padding-left: 10px;
  border-left: 3px solid var(--el-color-primary);
  font-size: 15px;
  line-height: 1.5;
  color: var(--el-text-color-primary);
}
.reading-blocks {
  display: grid;
  gap: 10px;
}
.reading-block {
  min-width: 0;
  font-size: 14px;
  line-height: 1.85;
  overflow-wrap: anywhere;
}
.reading-block p {
  margin: 0;
  white-space: pre-line;
}
.reading-block.item {
  display: flex;
  gap: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-extra-light);
  padding: 12px 14px;
}
.reading-marker {
  flex: 0 0 24px;
  color: var(--el-color-primary);
  font-weight: 600;
}
.reading-original {
  margin: 0;
  font: inherit;
  font-size: 14px;
  line-height: 1.85;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.reading-empty {
  color: var(--el-text-color-secondary);
  font-size: 14px;
  padding: 18px 0;
}
</style>
