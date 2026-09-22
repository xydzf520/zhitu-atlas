<template>
  <section class="recommendation-widget" aria-label="主动岗位推荐">
    <header>
      <div>

        <h2>{{ rows.length ? '推荐岗位' : '岗位推荐' }}</h2>
      </div>
      <RouterLink to="/main-layout/CareerDiscovery">进入机会发现 →</RouterLink>
    </header>
    <p v-if="failure" role="alert">{{ failure }}</p>
    <div v-if="rows.length" class="recommendation-cards">
      <RouterLink
        v-for="row in rows"
        :key="row.job.encryptJobId"
        :to="{ path: '/main-layout/CareerDiscovery', query: { job: row.job.encryptJobId } }"
        ><span
          >{{ row.job.salaryDesc || '薪资待核实' }} ·
          {{ row.job.cityName || '地点待核实' }}</span
        >
        <h3>{{ row.job.jobName }}</h3>
        <p>{{ row.job.companyName }}</p>
        <p class="why">
          {{
            (!row.analysisOutdated && row.item.analysis?.analysis?.recommendation?.reason) ||
            row.assessment.reasons[0] ||
            '查看匹配依据'
          }}
        </p>
        <small
          >{{
            row.analyzed && !row.analysisOutdated
              ? `AI · ${recommendationLabels[row.item.analysis?.analysis?.recommendation?.decision] || '已分析'}`
              : '规则初筛，待 AI 分析'
          }}{{ row.assessment.provisional ? ' · 经历待确认' : '' }}</small
        ></RouterLink
      >
    </div>
    <p v-else class="widget-empty">
      {{
        run?.message ||
        '暂无当前版本推荐。可到机会发现采集并分析岗位。'
      }}
    </p>
    <footer>
      {{
        settings?.autoRecommend
          ? `每天 ${settings.recommendTime} · 最多 ${settings.aiLimit} 次自动分析／日`
          : '可在机会发现开启每日推荐'
      }}
      · 新岗位先进入机会池，加入跟进后显示在地图。
    </footer>
  </section>
</template>
<script setup lang="ts">
import { recommendationLabels } from '../../../../common/discovery'
import { ref, onMounted, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
const rows = ref<any[]>([]),
  settings = ref<any>(),
  run = ref<any>(),
  failure = ref('')
let timer: ReturnType<typeof setInterval> | undefined,
  busy = false
async function load() {
  if (busy) return
  busy = true
  try {
    const d = await electron.ipcRenderer.invoke('career-discovery-list', {
      filter: 'priority',
      page: 1
    })
    rows.value = d.recommendations
    settings.value = d.settings
    run.value = d.run
    failure.value = ''
  } catch {
    failure.value = '推荐结果暂时不可读，可进入机会发现重试。'
  } finally {
    busy = false
  }
}
function start() {
  void load()
  if (!timer)
    timer = setInterval(() => {
      if (!document.hidden) void load()
    }, 30000)
}
function stop() {
  if (timer) clearInterval(timer)
  timer = undefined
}
onMounted(start)
onActivated(start)
onDeactivated(stop)
onBeforeUnmount(stop)
</script>
<style scoped>
.recommendation-widget {
  padding: 22px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 12px;
  margin-bottom: 22px;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
header small {
  font-size: 10px;
  letter-spacing: 1.5px;
  color: var(--el-color-primary);
}
h2 {
  font-size: 17px;
  margin: 7px 0 0;
}
header a {
  color: var(--el-color-primary);
  font-size: 13px;
}
.recommendation-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 18px;
}
.recommendation-cards a {
  display: block;
  text-decoration: none;
  padding: 16px;
  border: 1px solid var(--el-border-color);
  border-radius: 9px;
  color: var(--el-text-color-primary);
}
.recommendation-cards a:hover {
  border-color: var(--el-color-primary);
}
.recommendation-cards span {
  font-size: 12px;
  color: var(--el-color-primary);
}
h3 {
  font-size: 14px;
  line-height: 1.6;
  margin: 8px 0;
}
p {
  font-size: 12px;
  line-height: 1.8;
  margin: 5px 0;
}
.why,
small,
footer {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.8;
}
footer {
  margin-top: 14px;
}
.widget-empty {
  padding: 12px 0;
  color: var(--el-text-color-secondary);
}
@media (max-width: 1150px) {
  .recommendation-cards {
    grid-template-columns: 1fr;
  }
}
</style>
