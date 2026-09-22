<template>
  <section class="enterprise-board">
    <nav aria-label="企业进展展示方式">
      <button v-for="v in views" :key="v[0]" :aria-pressed="view === v[0]" @click="view = v[0]">
        {{ v[1] }}</button
      ><span>{{ items.length }} 个机会 · 阶段变更不等于发送消息</span>
    </nav>
    <template v-if="view === 'board'"
      ><div class="stage-summary" aria-label="所有求职阶段">
        <button
          v-for="stage in pipelineStages"
          :key="stage"
          :aria-pressed="selectedStage === stage"
          :style="{ '--lane-color': stageColors[stage] }"
          @click="selectedStage = selectedStage === stage ? '' : stage"
        >
          <i /><span>{{ stage }}</span
          ><b>{{ items.filter((o) => o.stage === stage).length }}</b>
        </button>
      </div>
      <div class="board-options">
        <span>点阶段数量筛选；再次点击恢复全部有记录的阶段。</span
        ><label><input type="checkbox" v-model="showEmpty" />显示空阶段</label
        ><button v-if="selectedStage" @click="selectedStage = ''">清除阶段筛选</button>
      </div>
      <div class="board" :class="{ single: visibleStages.length === 1 }">
        <section
          v-for="stage in visibleStages"
          :key="stage"
          class="lane"
          :style="{ '--lane-color': stageColors[stage] }"
        >
          <header>
            <i />
            <h3>{{ stage }}</h3>
            <b>{{ items.filter((o) => o.stage === stage).length }}</b>
          </header>
          <div class="lane-items">
            <article v-for="o in items.filter((o) => o.stage === stage).slice(0, 30)" :key="o.id">
              <button class="card-title" @click="emit('select', o)">{{ o.job.companyName }}</button>
              <p>{{ o.job.jobName }}</p>
              <small class="source-tag">{{ o.source }}</small>
              <div class="card-facts">
                <span>{{
                  o.job.salaryLow && o.job.salaryHigh
                    ? `${o.job.salaryLow}–${o.job.salaryHigh}K`
                    : '薪资待核实'
                }}</span
                ><span>{{ o.district }}</span>
              </div>
              <p v-if="o.nextDate" class="due">下一步 · {{ o.nextDate }}</p>
              <button class="edit-stage" @click="emit('select', o)">查看详情 / 更新阶段 →</button>
            </article>
          </div>
          <p v-if="!items.some((o) => o.stage === stage)" class="empty">暂无此阶段机会</p>
          <p v-if="items.filter((o) => o.stage === stage).length > 30">
            当前显示前 30 个，可用上方筛选缩小范围。
          </p>
        </section>
      </div></template
    >
    <div v-if="view === 'map'">
      <OpportunityMap
        :items="items"
        :city="city"
        :default-city="defaultCity"
        @city="emit('city', $event)"
        :selected-district="district"
        @district="district = $event"
        @select="emit('select', $event)"
      />
      <p>标记按真实记录显示；仅有行政区的公司不伪装为精确位置。</p>
    </div>
    <section v-if="view === 'calendar'">
      <div class="calendar-head">
        <button @click="offset--">上一月</button>
        <h3>{{ monthTitle }}</h3>
        <button @click="offset++">下一月</button>
      </div>
      <div class="calendar">
        <b v-for="d in ['一', '二', '三', '四', '五', '六', '日']" :key="d">{{ d }}</b>
        <div v-for="day in days" :key="day.key" :class="{ outside: !day.current }">
          <time>{{ day.day }}</time
          ><button v-for="event in day.events" :key="event.id" @click="selectEvent(event)">
            {{ event.body.title }}<small>{{ event.opportunity.job.companyName }}</small>
          </button>
        </div>
      </div>
      <p>
        {{
          pipeline?.related?.filter((r: any) => r.kind === 'interview').length || 0
        }}
        条面试记录，以本人填写时间为准；未知日期不放入日历。
      </p>
      <p v-if="error" role="alert">{{ error }}</p>
    </section>
    <AtlasOperations v-if="view === 'offers'" section="pipeline" /><slot v-if="view === 'list'" />
  </section>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  pipelineStages,
  stageColors,
  type DashboardOpportunity
} from '../../../../common/dashboard'
import OpportunityMap from './OpportunityMap.vue'
import AtlasOperations from './AtlasOperations.vue'
const props = defineProps<{ items: DashboardOpportunity[]; city?: string; defaultCity?: string }>(),
  emit = defineEmits<{ (e: 'select', o: DashboardOpportunity): void; (e: 'city', city: string): void }>(),
  view = ref('board'),
  district = ref(''),
  pipeline = ref<any>(),
  offset = ref(0),
  error = ref('')
const showEmpty = ref(false),
  selectedStage = ref('')
const visibleStages = computed(() =>
  selectedStage.value
    ? [selectedStage.value]
    : showEmpty.value
      ? pipelineStages
      : pipelineStages.filter((stage) => props.items.some((o) => o.stage === stage))
)
const views = [
  ['board', '阶段看板'],
  ['list', '企业列表'],
  ['map', '地图'],
  ['calendar', '面试日历'],
  ['offers', '面试与 Offer']
]
const month = computed(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth() + offset.value, 1)
  }),
  monthTitle = computed(() =>
    month.value.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
  )
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const days = computed(() => {
  const start = new Date(month.value)
  start.setDate(1 - ((start.getDay() + 6) % 7))
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const key = dateKey(d)
    return {
      key,
      day: d.getDate(),
      current: d.getMonth() === month.value.getMonth(),
      events: (pipeline.value?.related || []).filter(
        (r: any) =>
          r.kind === 'interview' &&
          r.body.date?.slice(0, 10) === key &&
          props.items.some((o) => o.id === r.opportunity.id)
      )
    }
  })
})
function selectEvent(e: any) {
  const o = props.items.find((o) => o.id === e.opportunity.id)
  if (o) emit('select', o)
}
async function loadPipeline() {
  try {
    pipeline.value = await electron.ipcRenderer.invoke('career-pipeline-summary')
  } catch (e) {
    error.value = String(e)
  }
}
watch(view, (v) => {
  if (v === 'calendar') void loadPipeline()
})
onMounted(loadPipeline)
</script>
<style scoped>
.enterprise-board {
  font-size: 13px;
}
.enterprise-board nav {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin: 20px 0;
}
.enterprise-board button {
  font: inherit;
  border: 1px solid var(--el-border-color);
  background: var(--atlas-panel);
  border-radius: 7px;
  padding: 8px 12px;
  color: var(--el-text-color-regular);
  cursor: pointer;
}
.enterprise-board button:hover,
.enterprise-board nav [aria-pressed='true'] {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary-light-7);
  background: var(--el-color-primary-light-9);
}
nav > span {
  margin-left: auto;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.stage-summary {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
  margin-top: 16px;
}
.stage-summary button {
  display: flex;
  gap: 7px;
  align-items: center;
  border-top: 3px solid var(--lane-color);
  padding: 12px 10px;
}
.stage-summary button[aria-pressed='true'] {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.stage-summary b {
  margin-left: auto;
}
.stage-summary i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--lane-color);
}
.board-options {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  margin: 12px 0;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
.board-options label {
  display: flex !important;
  flex-direction: row !important;
  gap: 6px !important;
  align-items: center;
  margin-left: auto;
}
.board.single .lane-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.board.single article {
  margin: 0;
}
.board {
  display: grid;
  align-items: start;
  grid-template-columns: repeat(auto-fit, minmax(235px, 1fr));
  gap: 14px;
}
.lane {
  min-width: 0;
  border-radius: 10px;
  background: var(--el-fill-color-light);
  padding: 12px;
  border-top: 3px solid var(--lane-color);
}
.lane header {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 3px 4px 16px;
}
.lane h3 {
  font-size: 13px;
  margin: 0;
  flex: 1;
}
.lane header i {
  width: 7px;
  height: 7px;
  background: var(--lane-color);
  border-radius: 50%;
}
.lane header b {
  color: var(--el-text-color-secondary);
}
.lane article {
  border: 1px solid var(--el-border-color);
  border-radius: 9px;
  background: var(--atlas-panel);
  padding: 15px;
  margin-bottom: 12px;
}
.lane .card-title {
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  border: 0;
  padding: 0;
  background: none;
  color: var(--el-text-color-primary);
}
.lane p {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.8;
}
.source-tag {
  display: inline-block;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border-radius: 4px;
  padding: 3px 6px;
  margin: 6px 0 10px;
  font-size: 10px;
}
.card-facts {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  font-size: 11px;
  color: var(--el-color-primary);
}
.lane .edit-stage {
  font-size: 11px;
  margin-top: 16px;
  background: none;
  border: 0;
  color: var(--el-color-primary);
  padding: 0;
}
.empty {
  padding: 20px;
  text-align: center;
}
.calendar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.calendar {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border-left: 1px solid var(--el-border-color);
}
.calendar > b {
  padding: 12px;
  text-align: center;
  background: var(--el-fill-color-light);
}
.calendar > div {
  min-height: 95px;
  padding: 8px;
  border-bottom: 1px solid var(--el-border-color);
  border-right: 1px solid var(--el-border-color);
}
.calendar .outside {
  opacity: 0.45;
}
.calendar button {
  display: block;
  font-size: 11px;
  padding: 7px;
  margin-top: 6px;
  width: 100%;
  text-align: left;
  background: var(--el-color-primary-light-9);
}
.calendar small {
  display: block;
  margin-top: 6px;
}
.calendar time {
  font-size: 12px;
}
.due {
  color: var(--el-color-warning-dark-2) !important;
}
@media (max-width: 1400px) {
  .stage-summary {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
