<template>
  <section v-if="!compact || pending" class="setup-guide" aria-label="开始使用 Atlas">
    <header>
      <div>
        <h2>开始使用 Atlas</h2>
        <p>先准备资料和求职方向，再选择需要的 AI 与平台功能。</p>
      </div>
      <button @click="demo = true">查看示例</button>
    </header>
    <p v-if="error" role="alert">{{ error }} <button @click="load">重试</button></p>
    <div v-else-if="loading" role="status">正在读取准备状态…</div>
    <ol v-else>
      <li v-for="(s, i) in steps" :key="s.id">
        <span class="step" :class="{ done: s.done }">{{ s.done ? '✓' : i + 1 }}</span>
        <div>
          <strong
            >{{ s.title }}
            <small>{{ s.done ? '已准备' : s.optional ? '按需配置' : '待完成' }}</small></strong
          >
          <p>{{ s.detail }}</p>
          <RouterLink :to="s.to">{{ s.done ? '查看' : '前往设置' }} →</RouterLink>
        </div>
      </li>
    </ol>
    <footer>
      <RouterLink to="/main-layout/CareerSettings?section=data">导入岗位文件</RouterLink
      ><span>新用户自动任务默认暂停；准备完成后在机会发现启动。</span
      ><button @click="load" :disabled="loading">检查准备状态</button>
    </footer>
    <ElDialog
      v-model="demo"
      title="看看如何使用 · 虚构示例"
      width="min(900px, 94vw)"
      append-to-body
    >
      <p>示例只在此窗口展示，不调用模型，不保存到岗位池，不发送消息。</p>
      <label
        >目标职业
        <ElSelect v-model="exampleIndex" aria-label="示例职业"
          ><ElOption
            v-for="(e, i) in careerExamples"
            :key="e.role"
            :value="i"
            :label="e.role" /></ElSelect
      ></label>
      <div class="demo-flow">
        <article>
          <small>01 岗位要求</small>
          <h3>{{ example.title }}</h3>
          <p>{{ demoJob.description }}</p>
        </article>
        <article>
          <small>02 本人经历</small>
          <h3>{{ example.role }}</h3>
          <p>{{ example.fact }}</p>
          <p>方向：{{ assessment.alignment.reason }}</p>
        </article>
        <article>
          <small>03 沟通草稿</small>
          <p>{{ draft }}</p>
          <small>此处为规则示例；真实 AI 草稿使用你的已确认资料。</small>
        </article>
      </div>
      <template #footer
        ><ElButton @click="demo = false">关闭示例</ElButton
        ><ElButton
          type="primary"
          @click="openProfile"
          >填写我的资料</ElButton
        ></template
      >
    </ElDialog>
  </section>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, onActivated, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElDialog, ElSelect, ElOption, ElButton } from 'element-plus'
import { emptyCareerState, assessCareerJob, draftCareerMessage } from '../../../../common/career'
import { setupSteps, careerExamples } from '../../../../common/setup'
const props = defineProps<{ compact?: boolean }>(),
  router = useRouter(),
  route = useRoute(),
  profile = ref(emptyCareerState().profile),
  configured = ref(false),
  connected = ref(false),
  loading = ref(false),
  error = ref(''),
  loaded = ref(false),
  demo = ref(false),
  exampleIndex = ref(0)
const steps = computed(() => setupSteps(profile.value, configured.value, connected.value)),
  pending = computed(() => !loaded.value || steps.value.some((s) => !s.optional && !s.done))
const example = computed(() => careerExamples[exampleIndex.value])
const evidence = computed(() => ({
  id: 'demo-only',
  title: '虚构示例',
  text: example.value.fact,
  confirmed: true,
  keywords: [example.value.topic],
  source: '演示用虚构资料'
}))
const demoJob = computed(() => ({
  jobName: example.value.title,
  companyName: '示例企业（虚构）',
  description: `招聘${example.value.title}，负责${example.value.topic}相关日常工作，参与问题分析、方案执行及团队协作。希望能够结合实际经历说明工作方法和结果，并在沟通中核实职责范围、团队要求及岗位条件。`,
  address: '示例城市'
}))
const assessment = computed(() =>
  assessCareerJob(demoJob.value, {
    ...emptyCareerState().profile,
    targetRoles: [example.value.role],
    evidence: [evidence.value]
  })
)
const draft = computed(() => draftCareerMessage(demoJob.value, evidence.value))
function openProfile() { demo.value = false; void router.push('/main-layout/CareerWorkspace') }
async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const [p, m, s] = await Promise.all([
      electron.ipcRenderer.invoke('career-workspace-load'),
      electron.ipcRenderer.invoke('career-model-settings'),
      electron.ipcRenderer.invoke('career-dashboard-load')
    ])
    profile.value = p.profile
    configured.value = m.configured
    connected.value = !!s.connection?.account
    loaded.value = true
  } catch {
    error.value = '准备状态读取失败，已保存的资料不受影响'
  } finally {
    loading.value = false
  }
}
onMounted(load)
onActivated(load)
watch(
  () => route.fullPath,
  () => {
    if (!props.compact || route.path.endsWith('CareerDashboard')) void load()
  }
)
</script>
<style scoped>
.setup-guide {
  background: var(--atlas-panel, #fff);
  border: 1px solid var(--el-border-color, #dce2eb);
  border-radius: 14px;
  padding: 24px;
  margin-bottom: 24px;
}
.setup-guide header,
.setup-guide footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
h2 {
  margin: 0;
  font-size: 20px;
}
.setup-guide p,
footer span {
  color: var(--el-text-color-secondary);
  line-height: 1.7;
  font-size: 13px;
}
ol {
  list-style: none;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
  margin: 24px 0;
}
li {
  display: flex;
  gap: 12px;
}
.step {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--el-fill-color);
  display: grid;
  place-items: center;
}
.done {
  color: var(--el-color-success);
}
strong small {
  display: block;
  font-weight: 400;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
button {
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--el-border-color);
  color: var(--el-color-primary);
  border-radius: 7px;
  padding: 8px 12px;
}
footer {
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color);
}
a {
  color: var(--el-color-primary);
  text-decoration: none;
  font-size: 13px;
}
.demo-flow {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 20px;
}
.demo-flow article {
  padding: 16px;
  background: var(--el-fill-color-light);
  border-radius: 10px;
  line-height: 1.8;
}
.demo-flow small {
  color: var(--el-text-color-secondary);
}
@media (max-width: 1000px) {
  ol {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 650px) {
  ol,
  .demo-flow {
    grid-template-columns: 1fr;
  }
}
</style>
