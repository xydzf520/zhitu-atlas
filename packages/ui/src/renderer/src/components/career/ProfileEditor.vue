<template>
  <div class="profile-editor">
    <div class="profile-overview" aria-label="资料使用状态">
      <button @click="section = 'resume'">
        <span>对外展示</span><b>简历全文</b
        ><small>{{ profile.resumeText.trim() ? '查看、编辑与导出' : '待补充简历' }}</small>
      </button>
      <button @click="showEvidence('confirmed')">
        <span>AI 可引用</span><b>{{ confirmedCount }} <em>项已确认经历</em></b
        ><small>用于岗位匹配和话术</small>
      </button>
      <button @click="showEvidence('pending')">
        <span>需要你核对</span><b>{{ profile.evidence.length - confirmedCount }} <em>项经历</em></b
        ><small>未经确认不用于自动话术</small>
      </button>
    </div>
    <div class="profile-layout">
      <aside class="profile-navigation">
        <nav aria-label="个人资料分类">
          <button
            v-for="(item, i) in sections"
            :key="item.id"
            :aria-current="section === item.id ? 'page' : undefined"
            @click="section = item.id"
          >
            <span>{{ String(i + 1).padStart(2, '0') }}</span>
            <div>
              <b>{{ item.title }}</b
              ><small>{{ item.note }}</small>
            </div>
          </button>
        </nav>
        <p>修改先保留在当前页面。保存后，AI 分析使用新版本。</p>
        <details class="profile-tools">
          <summary>相关求职工具</summary>
          <RouterLink to="/main-layout/CareerDiscovery">发现与评估岗位 →</RouterLink
          ><RouterLink to="/main-layout/CareerDashboard?view=companies">企业与进展 →</RouterLink
          ><RouterLink to="/main-layout/CareerWorkspace?tab=match">手动粘贴 JD →</RouterLink>
        </details>
      </aside>
      <main class="profile-content">
        <section v-if="section === 'resume'" class="profile-card">
          <header>
            <div>
              <h2>简历全文</h2>
              <p>先从用人单位看到的内容检查你的简历。</p>
            </div>
            <ElButton :disabled="disabled" @click="editingResume = !editingResume">{{
              editingResume ? '查看排版预览' : '编辑简历全文'
            }}</ElButton>
          </header>
          <p class="profile-tip">
            简历全文与下方的 AI
            经历库分别维护。修改经历不会自动改写简历，公司、项目和时间请在全文中对应检查。
          </p>
          <div v-if="editingResume" class="resume-edit">
            <ElInput
              v-model="profile.resumeText"
              :disabled="disabled"
              type="textarea"
              :autosize="{ minRows: 18 }"
              aria-label="简历全文编辑"
            />
            <p class="profile-caption">保留原文结构；此处的修改不会自动更新 BOSS 在线简历。</p>
          </div>
          <article v-else class="resume-document" aria-label="简历全文预览">
            <StructuredText
              v-if="profile.resumeText.trim()"
              :source="profile.resumeText"
              mode="resume"
              hide-toolbar
            /><ElEmpty v-else description="还没有简历全文"
              ><ElButton @click="editingResume = true">填写简历</ElButton></ElEmpty
            >
          </article>
          <footer>
            <ElButton
              :disabled="!profile.resumeText.trim()"
              @click="emit('copy', profile.resumeText)"
              >复制简历全文</ElButton
            ><small>{{
              dirty ? '有未保存修改，保存后才能导出 Word' : '导出 Word 使用已保存版本'
            }}</small>
          </footer>
        </section>
        <section v-else-if="section === 'basics'" class="profile-card">
          <header>
            <div>
              <h2>个人定位与优势</h2>
              <p>概括你整段职业经历形成的能力，再用代表成果支撑。</p>
            </div>
          </header>
          <ElForm label-position="top" :disabled="disabled"
            ><div class="profile-two-col">
              <ElFormItem label="姓名"
                ><ElInput v-model="profile.name" aria-label="姓名" /></ElFormItem
              ><ElFormItem label="个人定位"
                ><ElInput v-model="profile.headline" aria-label="个人定位"
              /></ElFormItem>
            </div>
            <ElFormItem label="个人优势"
              ><ElInput
                v-model="profile.summary"
                type="textarea"
                :autosize="{ minRows: 10 }"
                aria-label="个人优势" /></ElFormItem
          ></ElForm>
          <p class="profile-tip">
            建议按「核心能力 → 跨项目经验 → 可核实成果」表达。最近一份工作的职责与细节放入简历全文。
          </p>
          <footer>
            <ElButton :disabled="!profile.summary.trim()" @click="emit('copy', profile.summary)"
              >复制个人优势</ElButton
            ><small>可复制到 BOSS，平台保存状态需单独核对</small>
          </footer>
        </section>
        <section v-else-if="section === 'evidence'" class="profile-card">
          <header>
            <div>
              <h2>AI 可引用经历</h2>
              <p>把能证明你适合岗位的经历核实一次，供匹配、话术与面试准备复用。</p>
            </div>
            <ElButton :disabled="disabled" @click="addEvidence">添加经历</ElButton>
          </header>
          <div class="evidence-toolbar">
            <div role="group" aria-label="经历确认状态">
              <button
                v-for="f in evidenceFilters"
                :key="f.id"
                :aria-pressed="evidenceFilter === f.id"
                @click="showEvidence(f.id)"
              >
                {{ f.label }}
              </button>
            </div>
            <ElInput
              v-model="search"
              placeholder="搜索经历、成果或来源"
              aria-label="搜索经历"
              clearable
            />
          </div>
          <p class="profile-caption">
            已确认 {{ confirmedCount }} 项 / 共
            {{ profile.evidence.length }} 项。编辑事实、名称、来源或关键词后，需要重新确认。
          </p>
          <ElEmpty
            v-if="!filteredEvidence.length"
            :description="search ? '没有找到相关经历' : '此分类暂无经历'"
          />
          <details
            v-for="{ e, index } in filteredEvidence"
            :key="e.id || index"
            class="profile-evidence"
            :open="expandedEvidence === (e.id || String(index))"
          >
            <summary @click.prevent="toggleEvidence(e.id || String(index))">
              <span class="evidence-number">{{ String(index + 1).padStart(2, '0') }}</span>
              <div>
                <b>{{ e.title || '新增经历' }}</b>
                <p>{{ e.text || '填写这段经历中可以核实的事实与成果' }}</p>
              </div>
              <span :class="['evidence-status', { verified: e.confirmed }]">{{
                e.confirmed ? '已确认' : '待确认'
              }}</span>
            </summary>
            <div class="evidence-fields">
              <ElForm label-position="top" :disabled="disabled"
                ><ElFormItem label="经历名称"
                  ><ElInput
                    v-model="e.title"
                    @input="e.confirmed = false"
                    aria-label="经历名称" /></ElFormItem
                ><ElFormItem label="事实与成果"
                  ><ElInput
                    v-model="e.text"
                    @input="e.confirmed = false"
                    type="textarea"
                    :autosize="{ minRows: 4 }"
                    aria-label="经历事实与成果" /></ElFormItem
                ><ElFormItem label="依据来源"
                  ><ElInput
                    v-model="e.source"
                    @input="e.confirmed = false"
                    placeholder="例如：简历项目、代码分析或本人核实的业务结果" /></ElFormItem
                ><ElFormItem label="匹配关键词"
                  ><ElInput
                    :model-value="e.keywords.join('，')"
                    @update:model-value="
                      (v) => {
                        e.keywords = split(v)
                        e.confirmed = false
                      }
                    "
                    placeholder="用逗号分隔，例如：AI、产品规划、团队管理"
                /></ElFormItem>
                <ProjectEvidenceEditor :evidence="e" :disabled="disabled" :dirty="dirty" />
                <div class="evidence-confirm">
                  <ElCheckbox
                    v-model="e.confirmed"
                    :disabled="!e.title.trim() || !e.text.trim() || !e.source.trim()"
                    >已核对事实与来源，允许 AI 引用</ElCheckbox
                  ><ElButton link type="danger" @click="emit('remove-evidence', index)"
                    >移除此项</ElButton
                  >
                </div></ElForm
              >
            </div>
          </details>
        </section>
        <section v-else-if="section === 'qualifications'" class="profile-card">
          <header>
            <div>
              <h2>学历与资历</h2>
              <p>用于核对 JD 中的必要条件；未知项留空，避免自动补全。</p>
            </div>
            <ElButton :disabled="disabled" @click="addQualification">添加资历</ElButton>
          </header>
          <ElEmpty v-if="!profile.qualifications?.length" description="暂未填写学历或必要资历" />
          <details
            v-for="(f, i) in profile.qualifications || []"
            :key="f.id"
            class="profile-evidence"
            :open="expandedQualification === f.id"
          >
            <summary
              @click.prevent="expandedQualification = expandedQualification === f.id ? '' : f.id"
            >
              <div>
                <b>{{ f.label || '新增资历' }}</b>
                <p>{{ f.value || '填写本人实际情况' }}</p>
              </div>
              <span :class="['evidence-status', { verified: f.confirmed }]">{{
                f.confirmed ? '已确认' : '待确认'
              }}</span>
            </summary>
            <ElForm class="evidence-fields" label-position="top" :disabled="disabled"
              ><ElFormItem label="类别"
                ><ElSelect v-model="f.kind" @change="f.confirmed = false"
                  ><ElOption label="学历" value="education" /><ElOption
                    label="相关经验"
                    value="experience" /><ElOption
                    label="其他必要资历"
                    value="other" /></ElSelect></ElFormItem
              ><ElFormItem label="资历名称"
                ><ElInput v-model="f.label" @input="f.confirmed = false" /></ElFormItem
              ><ElFormItem label="实际情况"
                ><ElInput
                  v-model="f.value"
                  @input="f.confirmed = false"
                  placeholder="例如：产品经验及实际年数" /></ElFormItem
              ><ElFormItem label="依据来源"
                ><ElInput v-model="f.source" @input="f.confirmed = false"
              /></ElFormItem>
              <div class="evidence-confirm">
                <ElCheckbox
                  v-model="f.confirmed"
                  :disabled="!f.label.trim() || !f.value.trim() || !f.source.trim()"
                  >本人已核实，可用于必要条件匹配</ElCheckbox
                ><ElButton link type="danger" @click="removeQualification(i)">移除此项</ElButton>
              </div></ElForm
            >
          </details>
          <p v-if="removedQualification" class="profile-tip" role="status">
            已移除资历<ElButton link @click="undoQualification">撤销</ElButton>
          </p>
        </section>
        <section v-else class="profile-card">
          <header>
            <div>
              <h2>求职方向</h2>
              <p>与机会发现共用同一份策略，避免多个页面设置不一致。</p>
            </div>
          </header>
          <dl class="direction-list">
            <div>
              <dt>目标岗位</dt>
              <dd>{{ profile.targetRoles.join('、') || '尚未设置' }}</dd>
            </div>
            <div>
              <dt>工作城市</dt>
              <dd>{{ profile.preferredCities.join('、') || '尚未设置' }}</dd>
            </div>
            <div>
              <dt>期望月薪下限</dt>
              <dd>
                {{ profile.minimumMonthlyK == null ? '尚未设置' : profile.minimumMonthlyK + 'K' }}
              </dd>
            </div>
          </dl>
          <RouterLink class="direction-link" to="/main-layout/CareerDiscovery?settings=1"
            >前往机会发现修改求职策略 →</RouterLink
          >
          <p class="profile-tip">
            资料保存、BOSS 在线简历保存、自动发送是独立动作。确认经历不会开启自动发送。
          </p>
        </section>
      </main>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ElButton,
  ElCheckbox,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect
} from 'element-plus'
import type { CareerProfile } from '../../../../common/career'
import type { Qualification } from '../../../../common/contact'
import StructuredText from './StructuredText.vue'
import ProjectEvidenceEditor from './ProjectEvidenceEditor.vue'
const props = defineProps<{ profile: CareerProfile; disabled: boolean; dirty: boolean }>()
const emit = defineEmits<{
  (e: 'copy', text: string): void
  (e: 'remove-evidence', index: number): void
}>()
const expandedQualification = ref('')
const section = ref('resume'),
  editingResume = ref(false),
  evidenceFilter = ref('all'),
  search = ref(''),
  expandedEvidence = ref('')
const sections = [
  { id: 'resume', title: '简历全文', note: '预览与编辑' },
  { id: 'basics', title: '个人定位与优势', note: '你能带来的价值' },
  { id: 'evidence', title: 'AI 可引用经历', note: '事实、成果与来源' },
  { id: 'qualifications', title: '学历与资历', note: '必要条件核对' },
  { id: 'direction', title: '求职方向', note: '目标岗位与期望' }
]
const evidenceFilters = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待确认' },
  { id: 'confirmed', label: '已确认' }
]
const confirmedCount = computed(() => props.profile.evidence.filter((e) => e.confirmed).length)
const filteredEvidence = computed(() =>
  props.profile.evidence
    .map((e, index) => ({ e, index }))
    .filter(
      ({ e }) =>
        (expandedEvidence.value === e.id ||
          evidenceFilter.value === 'all' ||
          (evidenceFilter.value === 'confirmed' ? e.confirmed : !e.confirmed)) &&
        [e.title, e.text, e.source, ...e.keywords]
          .join(' ')
          .toLowerCase()
          .includes(search.value.trim().toLowerCase())
    )
)
const split = (v: string) =>
  v
    .split(/[,，、\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
function showEvidence(filter: string) {
  section.value = 'evidence'
  evidenceFilter.value = filter
  expandedEvidence.value = ''
}
function addEvidence() {
  const id = crypto.randomUUID()
  props.profile.evidence.push({
    id,
    title: '',
    text: '',
    source: '',
    keywords: [],
    confirmed: false
  })
  evidenceFilter.value = 'all'
  search.value = ''
  expandedEvidence.value = id
}
function toggleEvidence(id: string) {
  expandedEvidence.value = expandedEvidence.value === id ? '' : id
}
function addQualification() {
  props.profile.qualifications ||= []
  const id = 'qualification:' + crypto.randomUUID()
  expandedQualification.value = id
  props.profile.qualifications.push({
    id,
    kind: 'education',
    label: '',
    value: '',
    source: '',
    confirmed: false
  })
}
const removedQualification = ref<{ item: Qualification; index: number }>()
function removeQualification(index: number) {
  removedQualification.value = { item: props.profile.qualifications![index], index }
  props.profile.qualifications!.splice(index, 1)
}
function undoQualification() {
  if (removedQualification.value) {
    props.profile.qualifications!.splice(
      removedQualification.value.index,
      0,
      removedQualification.value.item
    )
    removedQualification.value = undefined
  }
}
</script>
<style scoped>
.profile-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin: 24px 0;
}
.profile-overview button {
  border: 1px solid var(--el-border-color-light);
  background: var(--atlas-panel);
  text-align: left;
  border-radius: 12px;
  padding: 18px 22px;
  font: inherit;
  cursor: pointer;
  color: inherit;
}
.profile-overview span,
.profile-overview small {
  display: block;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.profile-overview b {
  display: block;
  font-size: 24px;
  margin: 10px 0;
}
.profile-overview em {
  font-size: 14px;
  font-style: normal;
  font-weight: 500;
}
.profile-layout {
  display: grid;
  grid-template-columns: 196px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.profile-navigation {
  position: sticky;
  top: 0;
}
.profile-navigation nav {
  display: grid;
  gap: 6px;
}
.profile-navigation nav button {
  display: flex;
  gap: 12px;
  text-align: left;
  padding: 15px 12px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  cursor: pointer;
  border-radius: 9px;
  align-items: baseline;
}
.profile-navigation nav button[aria-current] {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-8);
  color: var(--el-color-primary);
}
.profile-navigation nav b {
  font-size: 14px;
}
.profile-navigation nav small {
  display: block;
  font-size: 11px;
  margin-top: 6px;
  color: var(--el-text-color-secondary);
}
.profile-navigation nav span {
  font-size: 11px;
  font-weight: 600;
}
.profile-navigation > p {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.8;
  padding: 8px 12px;
}
.profile-tools {
  border-top: 1px solid var(--el-border-color-light);
  padding: 16px 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.profile-tools summary {
  cursor: pointer;
}
.profile-tools a {
  display: block;
  margin-top: 14px;
  color: var(--el-color-primary);
  text-decoration: none;
}
.profile-content {
  min-width: 0;
}
.profile-card {
  background: var(--atlas-panel);
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  padding: 26px;
}
.profile-card > header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.profile-card h2 {
  margin: 0;
  font-size: 20px;
}
.profile-card header p {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin: 8px 0 0;
  line-height: 1.7;
}
.profile-tip {
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.8;
}
.resume-document {
  padding: 24px 12px;
  max-width: 900px;
  margin: auto;
  overflow-wrap: anywhere;
}
.resume-edit {
  margin-top: 20px;
}
.profile-card footer {
  border-top: 1px solid var(--el-border-color-light);
  padding-top: 18px;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.profile-card footer small,
.profile-caption {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.8;
}
.profile-two-col {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 18px;
}
.evidence-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.evidence-toolbar > div {
  display: flex;
  gap: 6px;
}
.evidence-toolbar > .el-input {
  width: 250px;
}
.evidence-toolbar button {
  font: inherit;
  font-size: 13px;
  border: 1px solid var(--el-border-color-light);
  background: transparent;
  color: inherit;
  border-radius: 7px;
  padding: 8px 13px;
  cursor: pointer;
}
.evidence-toolbar button[aria-pressed='true'] {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  border-color: var(--el-color-primary-light-7);
}
.profile-evidence {
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  margin: 12px 0;
  overflow: hidden;
}
.profile-evidence > summary {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 18px;
  cursor: pointer;
  list-style: none;
}
.profile-evidence > summary:after {
  content: '＋';
  color: var(--el-text-color-secondary);
}
.profile-evidence[open] > summary:after {
  content: '−';
}
.profile-evidence[open] > summary {
  background: var(--el-fill-color-light);
}
.profile-evidence summary > div {
  flex: 1;
  min-width: 0;
}
.profile-evidence summary b {
  font-size: 14px;
  line-height: 1.7;
}
.profile-evidence summary p {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  margin: 5px 0 0;
}
.evidence-number {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.evidence-status {
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 5px;
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-dark-2);
  white-space: nowrap;
}
.evidence-status.verified {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success-dark-2);
}
.evidence-fields {
  padding: 20px;
}
.evidence-confirm {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.evidence-confirm :deep(.el-checkbox__label) {
  white-space: normal;
  line-height: 1.6;
}
.evidence-confirm :deep(.el-checkbox) {
  height: auto;
}
.direction-list {
  margin: 24px 0;
}
.direction-list > div {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 16px;
  padding: 20px 0;
  border-bottom: 1px solid var(--el-border-color-light);
  font-size: 14px;
}
.direction-list dt {
  color: var(--el-text-color-secondary);
}
.direction-list dd {
  margin: 0;
}
.direction-link {
  color: var(--el-color-primary);
  font-size: 14px;
  display: inline-block;
  margin: 10px 0 20px;
}
.profile-editor button:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}
@media (max-width: 1250px) {
  .profile-layout {
    grid-template-columns: 170px minmax(0, 1fr);
    gap: 16px;
  }
  .profile-card {
    padding: 20px;
  }
  .profile-overview button {
    padding: 16px;
  }
  .profile-overview b {
    font-size: 22px;
  }
}
@media (max-width: 850px) {
  .profile-layout {
    grid-template-columns: 1fr;
  }
  .profile-navigation {
    position: static;
  }
  .profile-navigation nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .profile-navigation > p,
  .profile-tools {
    display: none;
  }
  .profile-overview {
    gap: 8px;
  }
  .profile-overview b {
    font-size: 18px;
  }
  .profile-overview em {
    display: block;
    font-size: 12px;
  }
  .profile-card > header {
    flex-wrap: wrap;
  }
  .profile-two-col {
    grid-template-columns: 1fr;
  }
  .profile-evidence > summary {
    padding: 12px;
    gap: 8px;
  }
  .evidence-number {
    display: none;
  }
}
</style>
