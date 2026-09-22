<template>
  <section class="model panel">
    <header>
      <div>
        <h2>模型连接</h2>
        <p>选择自己的服务商或本机模型，密钥仅保存在本机。</p>
      </div>
      <ElTag :type="config?.configured ? 'success' : 'info'">{{
        config?.configured ? '已配置' : '待配置'
      }}</ElTag>
    </header>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <div class="fields">
      <label
        >模型渠道<ElSelect v-model="provider" aria-label="模型渠道" @change="changeProvider"
          ><ElOption label="自定义 · Chat Completions 兼容接口" value="compatible" /><ElOption
            label="CommandCode · 多模型"
            value="commandcode" /><ElOption label="DeepSeek 官方" value="deepseek" /></ElSelect
      ></label>
      <label v-if="provider === 'compatible'"
        >Base URL<ElInput
          v-model="baseUrl"
          aria-label="模型 Base URL"
          placeholder="https://你的服务地址/v1"
          @input="key = ''"
        /><small
          >支持 HTTPS；本机服务可用 http://127.0.0.1:端口/v1。更换地址不会沿用旧地址的密钥。</small
        ></label
      >
      <label
        >默认模型<ElSelect
          v-model="selectedModel"
          filterable
          :allow-create="provider !== 'commandcode'"
          default-first-option
          aria-label="默认模型"
          placeholder="选择或输入模型 ID"
          :loading="loadingModels"
          ><ElOption
            v-for="m in choices"
            :key="m.id"
            :value="m.id"
            :label="m.name || m.id"
            :disabled="!m.protocol" /></ElSelect
      ></label>
      <label
        >API 密钥<ElInput
          v-model="key"
          type="password"
          show-password
          autocomplete="off"
          placeholder="同一渠道／地址留空保留；本机免密服务可不填"
          aria-label="API 密钥"
      /></label>
    </div>
    <div class="catalog" v-if="provider !== 'deepseek'">
      <span>{{
        catalog?.models?.length ? catalog.models.length + ' 个可选模型' : '可手动填写兼容模型 ID'
      }}</span
      ><ElButton
        :loading="loadingModels"
        :disabled="provider === 'compatible' && (!config?.configured || baseUrl !== config.baseUrl)"
        @click="loadModels(true)"
        >读取模型列表</ElButton
      >
    </div>
    <ElAlert v-if="catalog?.warning" :title="catalog.warning" type="warning" :closable="false" />
    <details class="advanced">
      <summary>输出预算与能力</summary>
      <div class="fields">
        <label
          >输出方式<ElSelect v-model="options.budgetMode" aria-label="输出方式"
            ><ElOption label="按任务限制 · 短话术用较少输出" value="task" /><ElOption
              label="固定上限 · 保留自定义预算"
              value="fixed" /></ElSelect
        ></label>
        <label
          >最大输出 tokens<ElInputNumber
            v-model="options.maxOutputTokens"
            :min="512"
            :max="393216"
            :step="512"
            aria-label="最大输出 tokens"
        /></label>
        <label
          >思考参数<ElSelect v-model="options.reasoning" aria-label="思考参数"
            ><ElOption label="模型默认" value="default" /><ElOption
              label="max · 已适配的 DeepSeek"
              value="max"
              :disabled="!isDeepseek" /></ElSelect
        ></label>
        <div class="capabilities">
          <ElCheckbox v-model="options.toolsEnabled">常规任务允许经历查询工具</ElCheckbox
          ><ElCheckbox v-model="options.jsonMode">接口支持 JSON 模式</ElCheckbox>
        </div>
      </div>
      <p>
        这些是请求参数，不代表服务商实际支持的上限。工具和 JSON
        模式需由模型支持；企业研判使用搜索与阅读工具，连接测试使用本地探针。所有工具都不能发送消息或修改经历。未返回上下文容量时显示未知。
      </p>
      <p>
        上下文：{{
          selected?.contextLength ||
          (selectedModel === config?.model ? config?.contextWindowTokens : null) ||
          '未知'
        }}
        tokens ·
        {{ selected?.protocol === 'anthropic' ? 'Anthropic Messages' : 'Chat Completions' }}
      </p>
    </details>
    <p v-if="endpoint" class="endpoint">请求地址：{{ endpoint }}</p>
    <p>生成时会将本次需要的经历、JD 或对话发送到所选服务。首次使用建议先测试，再开启自动任务。</p>
    <div class="actions">
      <ElButton
        :disabled="!dirty || !selectedModel || saving || testing"
        :loading="saving"
        @click="save"
        type="primary"
        >保存模型配置</ElButton
      ><ElButton
        :disabled="dirty || !config?.configured || saving || testing"
        :loading="testing"
        @click="test"
        >测试生成与工具调用</ElButton
      ><span role="status">{{ notice }}</span>
    </div>
    <section class="verification" aria-label="模型验证结果">
      <span>生成：{{ verification?.generation ? '已验证' : '待验证' }}</span
      ><span>工具与结果回传：{{ verification?.toolCalling ? '已验证' : '待验证' }}</span>
    </section>
    <p v-if="testing">
      {{ progress?.step || '正在准备测试'
      }}<ElButton v-if="progress?.id" link @click="cancelTest">取消测试</ElButton>
    </p>
    <p v-if="verification">
      {{ verification.note }} · {{ new Date(verification.at).toLocaleString() }}
    </p>
    <small>测试使用虚构样例，最多等待 2 分钟，可能产生模型费用；不会读取 BOSS 或发送消息。</small>
    <details class="advanced">
      <summary>本机存储与今日用量</summary>
      <p v-if="config?.storage?.localOnly">
        {{ config.storage.file }} · 不进入源码、安装包或迁移备份
      </p>
      <p>
        {{ usage?.day }} · 自动分析 {{ usage?.automaticAnalysis || 0 }}/{{
          usage?.analysisLimit ?? 30
        }}
        · {{ (usage?.totalTokens || 0).toLocaleString() }} tokens（服务商已返回部分）
      </p>
      <div class="usage-row" v-for="(c, i) in usage?.calls || []" :key="i">
        <span>{{ kinds[c.kind] || c.kind }}</span
        ><span>{{ c.status }}</span
        ><span>{{ c.usage?.total_tokens?.toLocaleString() ?? '未返回用量' }}</span>
      </div>
    </details>
    <RouterLink to="/main-layout/CareerAgents">管理 Agent 提示词与调用记录 →</RouterLink>
  </section>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  ElAlert,
  ElButton,
  ElInput,
  ElInputNumber,
  ElCheckbox,
  ElOption,
  ElSelect,
  ElTag
} from 'element-plus'
import { useDraftProtection } from '../../composables/useDraftProtection'
import { useAITasks } from '../../composables/atlasTasks'
const defaults = () => ({
  maxOutputTokens: 4096,
  budgetMode: 'task',
  reasoning: 'default',
  toolsEnabled: false,
  jsonMode: false
})
const config = ref<any>(),
  usage = ref<any>(),
  key = ref(''),
  error = ref(''),
  notice = ref(''),
  saving = ref(false),
  loadingModels = ref(false),
  testing = ref(false),
  catalog = ref<any>(),
  provider = ref('compatible'),
  selectedModel = ref(''),
  baseUrl = ref(''),
  options = ref(defaults()),
  initial = ref(''),
  progress = ref<any>()
const runTask = useAITasks(),
  kinds: Record<string, string> = {
    analysis: '岗位分析',
    strategy: '搜索复盘',
    greeting: '匹配招呼',
    reply: '沟通建议',
    followup: '跟进草稿',
    interview: '面试准备',
    'model-test': '模型测试'
  }
const official = ['deepseek-flash', 'deepseek-pro', 'deepseek-chat', 'deepseek-reasoner'].map(
  (id) => ({ id, name: id, protocol: 'chat', contextLength: null })
)
const choices = computed<any[]>(() =>
  provider.value === 'deepseek' ? official : catalog.value?.models || []
)
const selected = computed(() => choices.value.find((m) => m.id === selectedModel.value))
const isDeepseek = computed(
  () =>
    provider.value === 'deepseek' ||
    (provider.value === 'commandcode' && selectedModel.value.startsWith('deepseek/'))
)
const endpoint = computed(() =>
  provider.value === 'compatible'
    ? baseUrl.value
    : provider.value === 'commandcode'
      ? 'https://api.commandcode.ai/provider/v1' +
        (selected.value?.protocol === 'anthropic' ? '/messages' : '/chat/completions')
      : 'https://api.deepseek.com/chat/completions'
)
const form = () =>
  JSON.stringify({
    provider: provider.value,
    model: selectedModel.value,
    baseUrl: baseUrl.value,
    options: options.value
  })
const dirty = computed(() => !!key.value || (!!initial.value && form() !== initial.value))
const verification = computed(() => (dirty.value ? null : config.value?.verification))
watch(isDeepseek, (v) => {
  if (!v) options.value.reasoning = 'default'
})
function apply(c: any) {
  config.value = c
  provider.value = c.provider
  selectedModel.value = c.model
  baseUrl.value = c.baseUrl
  options.value = { ...c.generationOptions }
  initial.value = form()
}
function changeProvider() {
  selectedModel.value =
    provider.value === 'commandcode'
      ? 'deepseek/deepseek-v4.1-flash'
      : provider.value === 'deepseek'
        ? 'deepseek-flash'
        : ''
  baseUrl.value = ''
  key.value = ''
  catalog.value = null
  options.value = defaults()
  options.value.toolsEnabled = provider.value === 'commandcode'
  options.value.jsonMode = provider.value === 'deepseek'
  notice.value = '选择尚未保存'
  if (provider.value === 'commandcode') void loadModels()
}
async function loadModels(refresh = false) {
  loadingModels.value = true
  error.value = ''
  try {
    catalog.value = await electron.ipcRenderer.invoke('career-model-catalog', {
      refresh,
      provider: provider.value,
      baseUrl: baseUrl.value
    })
  } catch (e) {
    error.value = String(e)
  } finally {
    loadingModels.value = false
  }
}
async function load() {
  try {
    const [c, u] = await Promise.all([
      electron.ipcRenderer.invoke('career-model-settings'),
      electron.ipcRenderer.invoke('career-model-usage')
    ])
    usage.value = u
    apply(c)
    if (c.configured && c.provider === 'commandcode') void loadModels()
  } catch (e) {
    error.value = String(e)
  }
}
async function save() {
  saving.value = true
  error.value = ''
  try {
    const c = await electron.ipcRenderer.invoke('career-model-save', {
      provider: provider.value,
      model: selectedModel.value,
      baseUrl: baseUrl.value,
      secret: key.value,
      generationOptions: { ...options.value },
      baseRevision: config.value.revision
    })
    key.value = ''
    apply(c)
    notice.value = '已保存；自动任务与发送授权保持不变'
    return true
  } catch (e) {
    error.value = String(e)
    return false
  } finally {
    saving.value = false
  }
}
async function test() {
  testing.value = true
  error.value = ''
  notice.value = ''
  try {
    await runTask(
      'career-model-test',
      { baseRevision: config.value.revision },
      (t) => (progress.value = t)
    )
    await load()
    notice.value = '测试完成，请查看实际验证结果'
  } catch (e) {
    error.value = String(e)
    await load()
  } finally {
    testing.value = false
  }
}
async function cancelTest() {
  if (progress.value?.id)
    await electron.ipcRenderer.invoke('career-task-cancel', { id: progress.value.id })
}
useDraftProtection(dirty, save, '模型配置')
onMounted(load)
onBeforeUnmount(() => {
  key.value = ''
})
</script>
<style scoped>
.model {
  font-size: 14px;
}
.model header,
.actions,
.catalog {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.model h2 {
  font-size: 22px;
}
.model p,
.model small {
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}
.fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin: 24px 0;
}
.fields label {
  display: grid;
  gap: 8px;
  align-content: start;
}
.fields .el-select {
  width: 100%;
}
.capabilities {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.advanced {
  padding: 18px 0;
  border-top: 1px solid var(--el-border-color);
  margin-top: 18px;
}
.advanced summary {
  cursor: pointer;
  font-weight: 600;
}
.endpoint {
  overflow-wrap: anywhere;
}
.verification {
  display: flex;
  gap: 24px;
  padding: 20px 0;
  flex-wrap: wrap;
}
.usage-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 12px;
  padding: 8px 0;
}
.actions {
  justify-content: flex-start;
}
.model > a {
  display: block;
  margin-top: 20px;
}
@media (max-width: 760px) {
  .fields {
    grid-template-columns: 1fr;
  }
}
</style>
