<template>
  <section class="execution-summary" aria-label="当前 Agent 工作">
    <div>
      <strong>{{ title || 'Agent 当前工作' }}</strong>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-else-if="!data">正在读取运行记录…</p>
      <template v-else
        ><p v-if="data.items.length">
          {{ data.items[0].title }} · {{ stateLabel(data.items[0].state) }}
        </p>
        <p v-else>{{ data.automationPaused ? '自动任务已暂停' : '当前没有进行中的任务' }}</p>
        <small v-if="data.items[0]">{{
          data.items[0].currentStep?.label || data.items[0].summary
        }}</small
        ><small
          >{{ data.runningModels }} 次模型调用进行中<span v-if="data.sendingPaused">
            · 发送已暂停</span
          ></small
        ></template
      >
    </div>
    <RouterLink
      :to="{
        path: '/main-layout/CareerTasks',
        query: {
          tab: 'agents',
          ...(objectId ? { object: objectId } : {}),
          ...(agentId ? { agent: agentId } : {}),
          ...(data?.items[0] ? { run: data.items[0].id } : {})
        }
      }"
      >查看工作进度 →</RouterLink
    >
  </section>
</template>
<script setup lang="ts">
import { useExecutionFeed } from '../../composables/executionFeed'
import { executionStates } from '../../../../common/execution'
const props = withDefaults(
  defineProps<{
    objectId?: string
    agentId?: string
    title?: string
    active?: boolean
  }>(),
  { active: true }
)
const { data, error } = useExecutionFeed(() =>
  props.active === false
    ? null
    : { state: 'active', objectId: props.objectId || '', agentId: props.agentId || '' }
)
const stateLabel = (s: string) => executionStates[s] || s
</script>
<style scoped>
.execution-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  padding: 16px 20px;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--atlas-panel);
  margin: 14px 0;
  font-size: 13px;
}
.execution-summary p {
  margin: 5px 0;
  color: var(--el-text-color-primary);
}
.execution-summary small {
  display: block;
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}
.execution-summary a {
  color: var(--el-color-primary);
  white-space: nowrap;
}
</style>
