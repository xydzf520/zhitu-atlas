<template>
  <section class="hiring-brief" aria-label="用人视角与沟通准备">
    <header><h3>用人视角 · 怎样说明你的价值</h3><p>按岗位要求整理沟通依据，不推测某位 HR 或负责人的心理。</p></header>
    <ol class="perspectives">
      <li><span class="step">1</span><h4>HR：先核对必要条件</h4>
        <p v-if="brief.essentialCount">已确认满足 {{ brief.counts.met }} 项 · 待核实 {{ brief.counts.verify }} 项 · 缺口 {{ brief.counts.gap }} 项</p>
        <p v-else>报告未列出明确的必要条件，请对照原 JD 核对；不代表全部满足。</p><small>履历、地点、薪资和资历应前后一致；用事实回答。</small></li>
      <li><span class="step">2</span><h4>业务负责人：你能解决什么</h4><p>{{ brief.businessGoal || '待补齐岗位的业务目标' }}</p><small>这是岗位分析，实际优先级和成果口径需要面试确认。</small></li>
      <li><span class="step">3</span><h4>你：明确下一步</h4><p>{{ brief.next }}</p><small>匹配说明讲一项相关成果，并留一个便于回答的问题。</small></li>
    </ol>
    <details v-if="brief.proof.length" class="proof-cards"><summary>准备可追问的成果案例 · {{ brief.proof.length }} 项</summary>
      <article v-for="(p,i) in brief.proof" :key="i"><h4>{{ p.requirement }}</h4><p>{{ p.question }}</p><div v-for="e in p.evidence" :key="e.id"><strong>{{ e.title }}</strong><p>{{ e.text }}</p><small>依据：{{ e.source || '来源待补充' }}</small></div><p class="outline">按背景与目标 → 本人行动 → 结果与证据 → 边界与复盘组织回答；未知数字留空。</p></article>
    </details>
    <details v-if="brief.questions.length"><summary>向招聘方确认的问题 · {{ brief.questions.length }} 项</summary><ul><li v-for="(q,i) in brief.questions" :key="i">{{ q.question }}</li></ul></details>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { hiringBrief } from '../../../../common/hiring-guide'
const props = defineProps<{ result: any; evidence: any[]; outdated?: boolean }>()
const brief = computed(() => hiringBrief(props.result, props.evidence, props.outdated))
</script>
<style scoped>
.hiring-brief{border:1px solid var(--el-border-color);border-radius:12px;padding:20px;background:var(--atlas-panel);line-height:1.7}.hiring-brief h3{margin:0;font-size:16px}.hiring-brief h4{margin:10px 0;font-size:14px}.hiring-brief p{margin:6px 0;overflow-wrap:anywhere}.hiring-brief header p,.hiring-brief small,.outline{font-size:12px;color:var(--el-text-color-secondary)}.perspectives{list-style:none;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.perspectives>li{padding:16px;background:var(--el-fill-color-light);border-radius:9px;font-size:13px}.step{display:inline-grid;place-items:center;width:25px;height:25px;background:var(--el-color-primary-light-9);color:var(--el-color-primary);border-radius:50%;font-weight:600}.hiring-brief details{border-top:1px solid var(--el-border-color);padding-top:12px;margin-top:12px}.hiring-brief summary{cursor:pointer;color:var(--el-color-primary);font-size:13px}.hiring-brief article{padding:12px 0}.proof-cards article>div{background:var(--el-fill-color-light);padding:12px;margin-top:12px;font-size:13px}.proof-cards article>div p{white-space:pre-line}.hiring-brief li{margin-bottom:8px}@media(max-width:1000px){.perspectives{grid-template-columns:1fr}.hiring-brief{padding:15px}}
</style>
