<template>
  <section class="boss-workspace">
    <header class="boss-heading">
      <div>
        <small>BOSS / WORKSPACE</small>
        <h1>BOSS 工作台</h1>
      </div>
      <span v-if="status?.accountName" class="boss-account"
        >{{ status.accountName }} · 已加载 {{ status.loadedCount }} 个会话</span
      >
      <ElButton @click="showResumeTransfer">更新简历资料</ElButton>
    </header>
    <template v-if="runtime === 'desktop'">
      <div class="boss-toolbar">
        <ElButton :disabled="!status?.canGoBack" aria-label="BOSS 后退" @click="action('back')"
          >←</ElButton
        >
        <ElButton
          :disabled="!status?.canGoForward"
          aria-label="BOSS 前进"
          @click="action('forward')"
          >→</ElButton
        >
        <ElButton :loading="opening" @click="openPage(BOSS_CHAT_URL)">消息</ElButton>
        <ElButton @click="openPage(BOSS_JOBS_URL)">职位</ElButton>
        <ElButton @click="openPage(BOSS_RESUME_URL)">简历</ElButton>
        <span class="boss-address" :title="address">{{ address }}</span>
        <ElButton :disabled="!status?.created" @click="action('reload')">重新加载</ElButton>
      </div>
      <div class="boss-status" role="status">
        <span :class="{ connected: status?.sync === 'connected' }">{{ statusLabel }}</span>
        <span v-if="status?.recordedPage">{{ status.recordedPage.kind }} · 页面地址已自动记录</span>
        <span>切换工作台页面会保留 BOSS 页面，不自动刷新。</span>
        <span v-if="status?.coverage"
          >详情 {{ status.coverage.linkedDetails }}/{{ status.coverage.linkedJobs }} · 消息
          {{ status.coverage.messages }} 条 · 地址 {{ status.coverage.addresses }}/{{
            status.coverage.linkedJobs
          }}</span
        >
        <ElButton link :disabled="!status?.created" @click="action('sync')"
          >采集当前已加载内容</ElButton
        >
        <ElButton link @click="openExternal">独立浏览器打开</ElButton>
      </div>
      <p v-if="status?.session === 'new' && status?.sync !== 'connected'" class="boss-login-hint">
        首次使用窗口内 BOSS 可能需要登录一次，之后会保留登录状态。已登录的独立浏览器可以继续使用。
      </p>
      <p v-if="error || status?.error" class="boss-error" role="alert">
        {{ error || status?.error }}
      </p>
      <p v-if="status?.capture?.error" class="boss-error" role="alert">
        {{ status.capture.error }}
      </p>
      <BossSyncCoverage :coverage="status?.coverage" @changed="refreshStatus" />
      <div ref="viewport" class="boss-viewport" aria-label="BOSS 内嵌页面区域">
        <span>{{ opening ? '正在打开 BOSS…' : 'BOSS 页面将在这里显示' }}</span
        ><ElButton v-if="error" @click="activate">重试打开</ElButton>
      </div>
      <footer>
        后台自动补齐账号会话、正文和关联岗位；进度与暂停开关在总览「同步覆盖」。打开会话可能使 BOSS 标为已读，Atlas 保留待查看提醒。
      </footer>
    </template>
    <div v-else class="boss-web-guide">
      <h2>网页与桌面共享同步结果</h2>
      <p><RouterLink to="/main-layout/CareerDashboard?view=sync">查看当前账号同步结果 →</RouterLink></p>
      <p>
        启动桌面程序，点击左侧「BOSS
        工作台」。窗口内可查看职位、简历和消息，已加载的会话会同步到网页工作台。
      </p>
      <p>普通网页不能直接承载这个桌面浏览器。</p>
    </div>
    <ElDialog v-model="resumeTransfer" title="将最新资料更新到 BOSS" width="720px" @closed="restoreBossView">
      <p>使用职途 Atlas 桌面内已登录的 BOSS 会话。复制与本地保存不代表平台已经更新。</p>
      <p v-if="resumeError" role="alert">{{ resumeError }}</p>
      <template v-if="resumeProfile">
        <h3>个人优势 · 整体职业能力</h3>
        <p class="resume-strengths">{{ resumeProfile.summary }}</p>
        <ElButton @click="copyResume(resumeProfile.summary)">复制个人优势</ElButton>
        <details><summary>完整简历与工作经历参考</summary><pre class="resume-reference">{{ resumeProfile.resumeText }}</pre></details>
        <ElButton @click="copyResume(resumeProfile.resumeText)">复制完整简历参考</ElButton>
        <p>当前为待平台更新。请在对应的个人优势、工作经历与项目经历中保存；附件发送给招聘者是独立动作。</p>
      </template>
      <template #footer><ElButton @click="resumeTransfer=false">关闭</ElButton><ElButton v-if="runtime==='desktop'" type="primary" @click="continueResume">在本程序打开在线简历</ElButton></template>
    </ElDialog>
  </section>
</template>
<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  watch
} from 'vue'
import { useRoute } from 'vue-router'
import { ElButton, ElDialog, ElMessage } from 'element-plus'
import BossSyncCoverage from '../../components/career/BossSyncCoverage.vue'
import {
  BOSS_CHAT_URL,
  BOSS_JOBS_URL,
  BOSS_RESUME_URL,
  type BossBrowserStatus
} from '../../../../common/boss-browser'
const runtime = inject<'desktop' | 'web'>('atlas-runtime', 'desktop')
const route = useRoute(),
  viewport = ref<HTMLElement>(),
  status = ref<BossBrowserStatus>(),
  error = ref(''),
  opening = ref(false)
const resumeTransfer=ref(false),resumeProfile=ref<any>(null),resumeError=ref('')
async function showResumeTransfer(){
  if(runtime==='desktop') await electron.ipcRenderer.invoke('atlas-boss-overlay',true)
  resumeTransfer.value=true;resumeError.value=''
  try{resumeProfile.value=(await electron.ipcRenderer.invoke('career-workspace-snapshot')).state.profile}catch{resumeError.value='资料暂时无法读取，请稍后重试。'}
}
async function restoreBossView(){if(runtime==='desktop')await electron.ipcRenderer.invoke('atlas-boss-overlay',false)}
async function copyResume(text:string){try{await navigator.clipboard.writeText(text);ElMessage.success('已复制；在 BOSS 保存后才完成平台更新')}catch{ElMessage.error('复制失败，请选择文本手动复制')}}
async function continueResume(){resumeTransfer.value=false;await restoreBossView();await openPage(BOSS_RESUME_URL)}
let active = false,
  polling: ReturnType<typeof setInterval> | undefined,
  resize: ResizeObserver | undefined,
  lastRequest: unknown,
  generation = 0
const address = computed(() => {
  try {
    const url = new URL(status.value?.url || BOSS_CHAT_URL)
    return url.hostname + url.pathname
  } catch {
    return 'www.zhipin.com'
  }
})
const statusLabel = computed(() => {
  if (opening.value || status.value?.loading) return '页面加载中'
  if (status.value?.sync === 'connected') return '已连接 · 会话同步中'
  if (status.value?.sync === 'job-detail') return '职位页读取中 · 已有岗位按 ID 关联'
  if (status.value?.sync === 'login-required') return '等待确认账号，请查看 BOSS 页面'
  if (status.value?.sync === 'error') return '会话读取失败，可保留页面并稍后检查'
  return '进入消息页后同步已加载会话'
})
async function refreshStatus() {
  try { status.value = await electron.ipcRenderer.invoke('atlas-boss-status') } catch { error.value = '桌面连接暂不可用，请稍后重试。' }
}
async function updateBounds() {
  if (!active || !viewport.value || runtime !== 'desktop') return
  const rect = viewport.value.getBoundingClientRect()
  try {
    await electron.ipcRenderer.invoke('atlas-boss-layout', {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    })
  } catch {
    /* A main-window reload can race with observer cleanup. */
  }
}
async function openPage(url?: string) {
  if (runtime !== 'desktop' || opening.value) return
  opening.value = true
  error.value = ''
  const current = generation
  try {
    status.value = await electron.ipcRenderer.invoke('atlas-boss-open', { url })
    if (!active || current !== generation) await electron.ipcRenderer.invoke('atlas-boss-hide')
    else await updateBounds()
  } catch (e: any) {
    error.value = e?.message || '无法打开 BOSS，请重试。'
  } finally {
    opening.value = false
  }
}
async function action(value: string) {
  try {
    error.value = ''
    status.value = await electron.ipcRenderer.invoke('atlas-boss-action', value)
  } catch {
    error.value = '操作未完成，请检查 BOSS 页面后重试。'
  }
}
async function openExternal() {
  try {
    await electron.ipcRenderer.invoke('atlas-open-workspace-window', {
      url: status.value?.url || BOSS_CHAT_URL
    })
  } catch {
    error.value = '独立浏览器未能打开，请到设置中检查浏览器连接。'
  }
}
async function activate() {
  if (runtime !== 'desktop') return
  active = true
  generation++
  await nextTick()
  resize?.disconnect()
  resize = new ResizeObserver(() => void updateBounds())
  if (viewport.value) resize.observe(viewport.value)
  const request = route.query.request
  const url =
    request && request !== lastRequest && typeof route.query.url === 'string'
      ? route.query.url
      : undefined
  lastRequest = request
  await updateBounds()
  void openPage(url)
  if (polling) clearInterval(polling)
  polling = setInterval(async () => {
    if (!active) return
    try {
      status.value = await electron.ipcRenderer.invoke('atlas-boss-status')
    } catch {
      error.value = '桌面连接暂不可用，请重新打开工作台。'
    }
  }, 2000)
}
function deactivate() {
  active = false
  generation++
  resize?.disconnect()
  if (polling) {
    clearInterval(polling)
    polling = undefined
  }
  if (runtime === 'desktop') void electron.ipcRenderer.invoke('atlas-boss-hide').catch(() => {})
}
watch(
  () => route.query.request,
  () => {
    if (active && route.path.endsWith('/CareerBoss')) void activate()
  }
)
onActivated(activate)
onDeactivated(deactivate)
onBeforeUnmount(deactivate)
</script>
<style scoped>
.boss-workspace {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  padding: 22px 24px 12px;
  background: var(--atlas-bg);
}
.boss-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.boss-heading small {
  font-size: 10px;
  letter-spacing: 1.6px;
  color: var(--el-color-primary);
}
.boss-heading h1 {
  font-size: 23px;
  font-weight: 600;
  margin: 8px 0 0;
}
.boss-account {
  color: var(--el-color-success);
  font-size: 12px;
}
.boss-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--el-border-color);
  background: var(--atlas-panel);
  border-radius: 9px;
}
.boss-toolbar .el-button + .el-button {
  margin-left: 0;
}
.boss-address {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  padding: 0 10px;
}
.boss-status {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 9px 2px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
.boss-status .connected {
  color: var(--el-color-success);
}
.boss-status .el-button {
  margin-left: auto;
  font-size: 11px;
}
.boss-login-hint,
.boss-error {
  margin: 0 0 10px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.6;
  border-radius: 6px;
}
.boss-login-hint {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.boss-error {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
.boss-viewport {
  flex: 1;
  min-height: 0;
  background: var(--el-fill-color-light);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.boss-workspace footer {
  padding-top: 9px;
  font-size: 10px;
  color: var(--el-text-color-secondary);
}
.boss-web-guide {
  padding: 28px;
  background: var(--atlas-panel);
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--el-text-color-regular);
}
.resume-strengths,.resume-reference{white-space:pre-wrap;line-height:1.8;font-family:inherit;color:var(--el-text-color-primary)}
.resume-reference{font-size:13px}.resume-strengths{padding:12px;background:var(--el-fill-color-light);border-radius:8px}
</style>
