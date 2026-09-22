<template>
  <section class="analysis-report" aria-label="岗位分析报告">
    <p class="report-meta">
      {{ result.model }} · {{ result.cached ? '已保存的分析' : '本次生成' }} ·
      {{ result.createdAt ? new Date(result.createdAt).toLocaleString('zh-CN') : '生成时间未知' }}
    </p>
    <p v-if="result.provisional" class="report-warning" role="status">
      本报告使用了待确认的简历经历，仅作机会评估线索。请核实后再用于自荐或联系。
    </p>
    <p v-if="outdated" class="report-warning" role="status">
      资料、岗位或分析配置已变化，本报告已过期。请重新分析后再使用。
    </p>
    <section v-if="result.analysis.recommendation" class="report-goal">
      <h3>
        投入建议 · {{ recommendationLabels[result.analysis.recommendation.decision] || '待核实' }}
      </h3>
      <p>{{ result.analysis.recommendation.reason }}</p>
      <p><b>下一步：</b>{{ result.analysis.recommendation.nextStep }}</p>
    </section>
    <HiringBrief :result="result" :evidence="evidence" :outdated="outdated" />
    <section class="matrix-summary"><h3>要求—经历—证据状态</h3><div class="evidence-counts"><span class="met">已确认满足 {{ counts.met }} 项</span><span class="verify">待核实 {{ counts.verify }} 项</span><span class="gap">存在缺口 {{ counts.gap }} 项</span></div><div class="evidence-bar" aria-hidden="true"><i v-for="kind in ['met','verify','gap']" :key="kind" :class="kind" :style="{flex:counts[kind]}" /></div><details><summary>查看逐项要求与证据 · {{ requirements.length }} 项</summary><div class="matrix" role="table" aria-label="岗位要求与证据矩阵"><div role="row" class="matrix-head"><span role="columnheader">招聘要求</span><span role="columnheader">经历依据</span><span role="columnheader">核实状态</span></div><div v-for="(r,i) in requirements" :key="i" role="row"><span role="cell">{{ r.requirement }}<small v-if="r.essential"> · 必要条件</small></span><span role="cell">{{ r.evidenceIds?.map((id:string)=>evidence.find(e=>e.id===id)?.title || '引用待核实').join('、') || '暂无对应依据' }}</span><b role="cell" :class="state(r)">{{ labels[state(r)] }}</b></div></div></details></section>
    <div class="brief-grid"><section><h3>你可以突出</h3><ul><li v-for="(v,i) in result.analysis.strengths?.slice(0,3)" :key="i">{{ v }}</li></ul><p v-if="!result.analysis.strengths?.length">等待可核实的经历依据</p></section><section><h3>建议先确认</h3><ul><li v-for="(v,i) in result.analysis.gaps?.slice(0,3)" :key="i">{{ v }}</li></ul><p v-if="!result.analysis.gaps?.length">本次未列出缺口，仍需核实必要条件。</p></section></div>
    <ProjectEvidenceCards :projects="result.projects" />
    <details class="full-report"><summary>展开岗位目标、完整分析与准备建议</summary>
    <section class="report-goal">
      <h3>岗位业务目标</h3>
      <p>{{ result.analysis.businessGoal || '暂无业务目标分析' }}</p>
    </section>
    <section>
      <h3>
        招聘要求与经历匹配 <small>{{ result.analysis.requirements?.length || 0 }} 项</small>
      </h3>
      <p v-if="!result.analysis.requirements?.length" class="report-meta">暂无逐项匹配结论。</p>
      <article
        v-for="(item, index) in result.analysis.requirements"
        :key="index"
        class="requirement-card"
      >
        <h4>
          <span>{{ String(index + 1).padStart(2, '0') }}</span
          >{{ item.requirement }}
        </h4>
        <dl>
          <div>
            <dt>匹配判断</dt>
            <dd>{{ item.assessment }}</dd>
          </div>
          <div>
            <dt>经历依据</dt>
            <dd>
              <p v-if="!item.evidenceIds?.length" class="report-meta">
                没有关联已确认经历，需进一步核实。
              </p>
              <div v-for="id in item.evidenceIds" :key="id" class="evidence-reference">
                <template v-if="!outdated && evidence.find((e) => e.id === id)"
                  ><b
                    >{{ evidence.find((e) => e.id === id)?.title
                    }}{{ result.evidenceConfirmation?.[id] === false ? ' · 待本人确认' : '' }}</b
                  >
                  <details>
                    <summary>查看经历原文</summary>
                    <p>{{ evidence.find((e) => e.id === id)?.text }}</p>
                  </details></template
                >
                <span v-else>旧版本或缺失的经历引用（{{ id }}），请重新核对。</span>
              </div>
            </dd>
          </div>
        </dl>
      </article>
    </section>
    <div class="report-grid">
      <section v-for="section in sections" :key="section.key" :class="['report-list', section.key]">
        <h3>
          {{ section.title }} <small>{{ result.analysis[section.key]?.length || 0 }} 项</small>
        </h3>
        <ol v-if="result.analysis[section.key]?.length">
          <li v-for="(text, i) in result.analysis[section.key]" :key="i">{{ text }}</li>
        </ol>
        <p v-else class="report-meta">{{ section.empty }}</p>
      </section>
    </div>
    </details>
    <details class="report-version">
      <summary>分析来源与版本</summary>
      <dl>
        <div v-if="result.maxOutputTokens">
          <dt>本次输出预算</dt>
          <dd>
            {{ result.maxOutputTokens.toLocaleString() }} tokens ·
            {{ result.thinking === 'enabled' ? '思考模式 max' : '非思考模式' }}
          </dd>
        </div>
        <div v-if="result.usage">
          <dt>实际用量</dt>
          <dd>
            输入 {{ result.usage.prompt_tokens ?? '未知' }} / 输出
            {{ result.usage.completion_tokens ?? '未知' }} tokens
          </dd>
        </div>
        <div>
          <dt>资料版本</dt>
          <dd>{{ result.profileVersion || '未知' }}</dd>
        </div>
        <div>
          <dt>提示词版本</dt>
          <dd>{{ result.promptVersion || '未知' }}</dd>
        </div>
      </dl>
    </details>
  </section>
</template>
<script setup lang="ts">
import HiringBrief from './HiringBrief.vue'
import ProjectEvidenceCards from './ProjectEvidenceCards.vue'
import { computed } from 'vue'
import { recommendationLabels } from '../../../../common/discovery'
import { requirementEvidenceState } from '../../../../common/hiring-guide'
import type { CareerEvidence } from '../../../../common/career'
const props = defineProps<{ result: any; evidence: CareerEvidence[]; outdated?: boolean }>()
const requirements=computed(()=>props.result.analysis.requirements || [])
const labels:Record<string,string>={met:'已确认满足',verify:'待核实',gap:'存在缺口'}
function state(r:any){return requirementEvidenceState(r,props.result,props.evidence,props.outdated)}
const counts=computed<Record<string,number>>(()=>requirements.value.reduce((a:Record<string,number>,r:any)=>{a[state(r)]++;return a},{met:0,verify:0,gap:0}))
const sections = [
  { key: 'strengths', title: '可突出优势', empty: '本次没有列出可确认的优势。' },
  { key: 'gaps', title: '缺口与待核实', empty: '本次没有列出缺口，不代表全部要求已满足。' },
  { key: 'questions', title: '面试准备', empty: '本次没有生成面试问题。' },
  { key: 'resumeSuggestions', title: '简历优化建议', empty: '本次没有生成简历建议。' }
]
</script>
<style scoped>
.evidence-counts{display:flex;gap:20px;flex-wrap:wrap;font-size:12px}.met{color:var(--el-color-success)}.verify{color:var(--el-color-warning-dark-2)}.gap{color:var(--el-color-danger)}.evidence-bar{height:6px;display:flex;gap:3px;margin:15px 0 20px;border-radius:4px;overflow:hidden;background:var(--el-fill-color-light)}.evidence-bar .met{background:var(--el-color-success)}.evidence-bar .verify{background:var(--el-color-warning)}.evidence-bar .gap{background:var(--el-color-danger)}.matrix>div{display:grid;grid-template-columns:1.2fr 1fr 95px;gap:16px;border-bottom:1px solid var(--el-border-color);padding:14px 8px;font-size:13px}.matrix .matrix-head{background:var(--el-fill-color-light);color:var(--el-text-color-secondary);font-size:12px}.matrix b{font-weight:500}.brief-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.brief-grid>section{border-radius:10px;padding:18px;background:var(--el-fill-color-light)}.brief-grid ul{margin:0;padding-left:18px;display:grid;gap:12px}.full-report>section,.full-report>.report-grid{margin-top:22px}.full-report>summary{font-size:14px;font-weight:600;padding:14px;border:1px solid var(--el-border-color);border-radius:8px}@media(max-width:700px){.brief-grid{grid-template-columns:1fr}.matrix>div{grid-template-columns:1fr 1fr}.matrix b{grid-column:1/-1}}

.analysis-report {
  display: grid;
  gap: 22px;
  font-size: 14px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
h3 {
  font-size: 15px;
  margin: 0 0 12px;
  color: var(--el-text-color-primary);
}
h4 {
  display: flex;
  gap: 12px;
  font-size: 14px;
  margin: 0 0 12px;
}
h4 span {
  color: var(--el-color-primary);
}
small,
.report-meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: normal;
}
.report-meta,
p {
  margin: 0;
  white-space: pre-line;
}
.report-goal {
  padding: 18px;
  border-left: 3px solid var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-radius: 6px;
}
.requirement-card {
  margin: 10px 0;
  border: 1px solid var(--el-border-color);
  padding: 18px;
  border-radius: 10px;
}
dl,
dd {
  margin: 0;
}
dl > div {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 12px;
  margin-top: 10px;
}
dt {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.evidence-reference {
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  margin-bottom: 8px;
}
.evidence-reference b {
  font-size: 13px;
}
summary {
  cursor: pointer;
  color: var(--el-color-primary);
  font-size: 12px;
}
.report-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.report-list {
  border: 1px solid var(--el-border-color);
  padding: 18px;
  border-radius: 10px;
}
.report-list ol {
  padding-left: 20px;
  margin: 0;
  display: grid;
  gap: 10px;
}
.report-warning {
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-9);
  padding: 12px;
  border-radius: 6px;
}
@media (max-width: 700px) {
  .report-grid {
    grid-template-columns: 1fr;
  }
}
</style>
