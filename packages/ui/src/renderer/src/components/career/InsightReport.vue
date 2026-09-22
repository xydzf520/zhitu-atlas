<template>
  <div class="insight-report">
    <p v-if="report.stale" class="stale" role="status">依据已更新，以下为旧版研判。</p>
    <p class="conclusion">{{ report.summary }}</p>
    <div class="findings">
      <article
        v-for="(finding, i) in expanded ? report.findings : report.findings.slice(0, 3)"
        :key="i"
      >
        <span :class="['signal', finding.kind]">{{ labels[finding.kind] }}</span>
        <div>
          <h3>{{ finding.title }}</h3>
          <p>{{ finding.detail }}</p>
          <details>
            <summary>依据 · {{ finding.sourceIds.length }}</summary>
            <ul>
              <li v-for="id in finding.sourceIds" :key="id">{{ source(id) }}</li>
            </ul>
          </details>
        </div>
      </article>
    </div>
    <button v-if="report.findings.length > 3" class="more" @click="expanded = !expanded">
      {{ expanded ? '收起' : '其余 ' + (report.findings.length - 3) + ' 项研判' }}
    </button>
    <details v-if="report.actions.length" class="suggestions" open>
      <summary>建议调整</summary>
      <button
        v-for="(item, i) in report.actions"
        :key="i"
        @click="emit('action', item.destination)"
        :disabled="report.stale"
      >
        <span
          ><b>{{ item.title }}</b
          ><small>{{ item.reason }}</small
          ><small>依据：{{ item.sourceIds.map(source).join('、') }}</small></span
        ><span aria-hidden="true">↗</span>
      </button>
    </details>
    <details class="report-notes">
      <summary>范围与版本</summary>
      <p>{{ report.model }} · {{ new Date(report.createdAt).toLocaleString('zh-CN') }}</p>
      <ul>
        <li v-for="line in report.limitations" :key="line">{{ line }}</li>
      </ul>
      <p>AI 建议供核对，未修改资料、筛选或发送设置。</p>
    </details>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
const expanded = ref(false)
const props = defineProps<{ report: any }>(),
  emit = defineEmits<{ (e: 'action', value: string): void }>()
const labels: Record<string, string> = {
  strength: '优势',
  gap: '可改进',
  opportunity: '机会',
  unknown: '待核实'
}
const source = (id: string) =>
  props.report.sources?.find((s: any) => s.id === id)?.label || '来源已不可用'
</script>
<style scoped>
.more {
  border: 0;
  background: none;
  color: var(--el-color-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 8px 0;
}
.conclusion {
  font-size: 15px;
  line-height: 1.8;
  color: var(--el-text-color-primary);
  margin: 0 0 20px;
}
.findings article {
  display: flex;
  gap: 12px;
  padding: 14px 0;
  border-top: 1px solid var(--el-border-color-lighter);
}
.findings article > div {
  min-width: 0;
  flex: 1;
}
.findings h3 {
  font-size: 14px;
  margin: 0 0 6px;
}
.findings p {
  font-size: 13px;
  line-height: 1.8;
  margin: 0;
  color: var(--el-text-color-regular);
}
.signal {
  align-self: flex-start;
  padding: 3px 7px;
  background: #f0f2f5;
  color: #627083;
  font-size: 11px;
  white-space: nowrap;
  border-radius: 4px;
}
.strength {
  color: #187552;
  background: #edf7f1;
}
.gap {
  color: #9d6214;
  background: #fff5e6;
}
.opportunity {
  color: #315cc2;
  background: #eef3ff;
}
summary {
  cursor: pointer;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
details {
  margin-top: 10px;
}
.findings ul,
.report-notes {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.7;
}
.suggestions {
  border-top: 1px solid var(--el-border-color);
  padding-top: 15px;
  margin-top: 12px;
}
.suggestions > summary {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.suggestions button {
  display: flex;
  align-items: center;
  gap: 15px;
  justify-content: space-between;
  text-align: left;
  width: 100%;
  padding: 12px 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.suggestions button:disabled {
  cursor: default;
  opacity: 0.7;
}
.suggestions b {
  font-size: 13px;
  font-weight: 550;
}
.suggestions small {
  display: block;
  margin-top: 5px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.stale {
  padding: 10px 12px;
  background: #fff5e6;
  color: #925c14;
  font-size: 12px;
  border-radius: 6px;
}
.report-notes {
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 14px;
}
</style>
