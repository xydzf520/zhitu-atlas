<template>
  <section class="progress">
    <div v-if="detail" class="actions">
      <ElButton @click="archive">{{ detail.body.archived ? '恢复机会' : '归档机会' }}</ElButton
      ><ElButton v-if="detail.body.mergedInto" @click="unmerge(props.id)">撤销当前合并</ElButton>
    </div>
    <details v-if="detail?.candidates.length">
      <summary>相似岗位 {{ detail.candidates.length }} 个，需本人判断是否为同一机会</summary>
      <p>确认合并后保留全部来源与历史；仅隐藏重复条目，可随时撤销。</p>
      <article v-for="candidate in detail.candidates" :key="candidate.id">
        <span
          >{{ candidate.body.job.companyName }} · {{ candidate.body.job.jobName }} ·
          {{ candidate.body.source }}</span
        ><ElButton @click="merge(candidate)">合并到此机会</ElButton>
      </article>
    </details>
    <article v-for="source in detail?.merged || []" :key="source.id">
      <span>已合并来源：{{ source.body.source }} · {{ source.body.job.jobName }}</span
      ><ElButton @click="unmerge(source.id)">撤销合并</ElButton>
    </article>
    <details v-if="detail?.companyOpportunities.length > 1">
      <summary>同一来源企业的 {{ detail.companyOpportunities.length }} 个岗位</summary>
      <p v-for="item in detail.companyOpportunities" :key="item.id">
        {{ item.body.job.jobName }} · {{ item.body.stage }} · {{ item.body.source }}
      </p>
    </details>
    <p v-if="detail?.companyContacts.length">
      招聘联系人：{{
        detail.companyContacts.map((c: any) => c.body.name || '姓名待补充').join('、')
      }}
    </p>
    <section class="interview-prep"><h3>AI 面试准备</h3><p>复用当前岗位、已确认经历与历史沟通，生成问题和证据卡。</p><ElButton :loading="preparing" @click="prepare">{{ preparation ? '查看 / 更新面试准备' : '生成面试准备' }}</ElButton><RouterLink v-if="preparing" to="/main-layout/CareerTasks">后台处理中，可在任务中心取消</RouterLink><template v-if="preparation"><p>{{ preparation.focus }}</p><article v-for="(q,i) in preparation.questions" :key="i"><div><h4>{{ i+1 }}. {{ q.question }}</h4><small>{{ perspectiveLabel(q.perspective) }}</small><p>{{ q.outline }}</p><small>经历依据：{{ q.evidenceIds.map((id:string) => preparation.evidence?.find((e:any)=>e.id===id)?.title || '引用待核实').join('、') || '反向提问或需要本人补充' }}</small></div></article><ul><li v-for="(v,i) in preparation.checklist" :key="i">{{ v }}</li></ul></template></section><h3>面试、Offer 与待办</h3>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div v-if="detail">
      <article v-for="r in detail.related" :key="r.id">
        <div>
          <b>{{ labels[r.kind] }} · {{ r.body.title }}</b>
          <p>
            {{ r.body.date ? new Date(r.body.date).toLocaleString() : '时间待定' }} ·
            {{ r.body.completed ? '已完成' : '跟进中' }}
          </p>
          <p v-if="r.kind === 'offer'">
            月薪 {{ r.body.monthlyK ?? '待确认' }} K × {{ r.body.salaryMonths ?? '待确认' }} 薪 ·
            奖金 {{ r.body.bonusK ?? '待确认' }} K
          </p>
          <p>{{ r.body.note }}</p>
        </div>
        <ElButton link @click="edit(r)">编辑</ElButton>
      </article>
      <ElSelect v-model="kind" :disabled="!!editingId"
        ><ElOption v-for="(label, key) in labels" :key="key" :value="key" :label="label"
      /></ElSelect>
      <ElInput
        v-model="form.title"
        placeholder="例如：一面／收到 Offer／补充经历材料"
        maxlength="200"
      />
      <div class="two">
        <label
          >{{ kind === 'offer' ? '答复截止时间' : '时间'
          }}<ElDatePicker
            v-model="form.date"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ssZ"
            placeholder="待定可留空" /></label
        ><label>联系人／面试官<ElInput v-model="form.contact" /></label>
      </div>
      <div v-if="kind === 'interview'" class="two">
        <label>面试轮次<ElInputNumber v-model="form.round" :min="1" :max="30" /></label
        ><label
          >形式／地址<ElInput v-model="form.location" placeholder="线上、现场或待确认" /></label
        ><label
          >面试结果<ElSelect v-model="form.outcome"
            ><ElOption label="待反馈" value="待反馈" /><ElOption
              label="进入下一轮"
              value="进入下一轮" /><ElOption label="未通过" value="未通过" /><ElOption
              label="本人放弃"
              value="本人放弃" /></ElSelect
        ></label>
      </div>
      <div v-if="kind === 'offer'" class="two">
        <label>税前月薪 K<ElInputNumber v-model="form.monthlyK" :min="0" /></label
        ><label>薪资月数<ElInputNumber v-model="form.salaryMonths" :min="1" :max="36" /></label
        ><label>奖金 K<ElInputNumber v-model="form.bonusK" :min="0" /></label
        ><label>工作地点<ElInput v-model="form.location" /></label>
      </div>
      <ElInput
        v-model="form.note"
        type="textarea"
        :rows="3"
        :placeholder="
          kind === 'interview'
            ? '轮次、形式、准备项、反馈与下一步'
            : kind === 'offer'
              ? '职责、薪酬构成、条件与本人决策'
              : '待办内容与下一步'
        "
      />
      <ElCheckbox v-model="form.completed">已完成／已作出决定</ElCheckbox>
      <div class="actions">
        <ElButton :loading="saving" type="primary" @click="save">{{
          editingId ? '保存记录' : '添加记录'
        }}</ElButton
        ><ElButton v-if="editingId" @click="reset">取消编辑</ElButton>
      </div>
      <h3>阶段与操作历史</h3>
      <p v-for="e in detail.events.slice(0, 20)" :key="e.id">
        {{ new Date(e.created_at).toLocaleString() }} · {{ eventLabel(e) }}
      </p>
    </div>
  </section>
</template>
<script setup lang="ts">
import { useAITasks } from '../../composables/atlasTasks'
const runAITask = useAITasks()
import { computed, ref, watch } from 'vue'
import {
  ElAlert,
  ElButton,
  ElCheckbox,
  ElDatePicker,
  ElInput,
  ElInputNumber,
  ElMessageBox,
  ElOption,
  ElSelect
} from 'element-plus'
const props = defineProps<{ id: string }>(),
  detail = ref<any>(null),
  error = ref(''),
  saving = ref(false),
  kind = ref('interview'),
  editingId = ref(''),
  revision = ref(0)
const emit = defineEmits<{ (e: 'changed'): void }>()
const preparation=ref<any>(),preparing=ref(false)
const perspectiveLabel=(p:string)=>({hr:'HR：履历与准入核对',business:'业务负责人：成果与交付',candidate:'你：确认岗位与合作条件'} as Record<string,string>)[p] || '围绕岗位准备'
async function prepare(){
 const id=props.id
 preparing.value=true;error.value=''
 try { const value=await runAITask('career-interview-prepare',{id});if(id===props.id)preparation.value=value }
 catch(e){if(id===props.id)error.value=String(e)}
 finally{if(id===props.id)preparing.value=false}
}
const relatedParent = ref('')
const labels: Record<string, string> = { interview: '面试', offer: 'Offer', todo: '待办' }
const empty = () => ({
  title: '',
  date: '',
  contact: '',
  note: '',
  completed: false,
  round: undefined as number | undefined,
  outcome: '待反馈',
  monthlyK: undefined as number | undefined,
  salaryMonths: undefined as number | undefined,
  bonusK: undefined as number | undefined,
  location: ''
})
const form = ref(empty()),
  formBaseline = ref(JSON.stringify(empty()))
const hasDraft = computed(() => JSON.stringify(form.value) !== formBaseline.value)
defineExpose({ hasDraft, save })
async function load() {
  const id=props.id
  error.value = ''
  try {
    const value=await electron.ipcRenderer.invoke('career-pipeline-detail', id)
    if(id===props.id)detail.value=value
  } catch (e) {
    error.value = String(e)
  }
}
function reset() {
  editingId.value = ''
  relatedParent.value = ''
  revision.value = 0
  form.value = empty()
  formBaseline.value = JSON.stringify(form.value)
}
function edit(row: any) {
  editingId.value = row.id
  relatedParent.value = row.opportunity_id
  revision.value = row.revision
  kind.value = row.kind
  form.value = { ...empty(), ...row.body }
  formBaseline.value = JSON.stringify(form.value)
}
async function save() {
  saving.value = true
  error.value = ''
  try {
    await electron.ipcRenderer.invoke('career-pipeline-save', {
      id: editingId.value || undefined,
      opportunityId: relatedParent.value || props.id,
      kind: kind.value,
      body: JSON.parse(JSON.stringify(form.value)),
      baseRevision: revision.value
    })
    reset()
    await load()
    emit('changed')
    return true
  } catch (e) {
    error.value = String(e)
    return false
  } finally {
    saving.value = false
  }
}
async function archive() {
  try {
    detail.value = await electron.ipcRenderer.invoke('career-pipeline-archive', {
      id: props.id,
      baseRevision: detail.value.revision,
      archived: !detail.value.body.archived
    })
    emit('changed')
  } catch (e) {
    error.value = String(e)
  }
}
async function merge(candidate: any) {
  try {
    await ElMessageBox.confirm(
      '确认这是同一岗位机会？当前条目会关联到所选机会，来源与记录继续保留。',
      '合并机会',
      { confirmButtonText: '确认合并', cancelButtonText: '取消' }
    )
    await electron.ipcRenderer.invoke('career-pipeline-merge', {
      id: props.id,
      targetId: candidate.id,
      baseRevision: detail.value.revision,
      targetRevision: candidate.revision
    })
    await load()
    emit('changed')
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') error.value = String(e)
  }
}
async function unmerge(id: string) {
  try {
    const source = await electron.ipcRenderer.invoke('career-pipeline-detail', id)
    await electron.ipcRenderer.invoke('career-pipeline-unmerge', {
      id,
      baseRevision: source.revision
    })
    await load()
    emit('changed')
  } catch (e) {
    error.value = String(e)
  }
}
function eventLabel(e: any) {
  return e.kind === 'stage-change'
    ? `${e.value.from} → ${e.value.to}${e.value.reason ? ' · ' + e.value.reason : ''}`
    : e.kind === 'opportunity-added'
      ? '建立机会'
      : e.value.title ||
        (
          {
            archived: '归档机会',
            restored: '恢复机会',
            'opportunity-merged': '合并机会',
            'opportunity-merge-undone': '撤销合并'
          } as Record<string, string>
        )[e.kind] ||
        e.kind
}
watch(
  () => props.id,
  () => {
    reset()
    detail.value=null
    preparation.value=null
    preparing.value=false
    void load()
  },
  { immediate: true }
)
</script>
<style scoped>
.progress {
  padding: 20px 0;
  border-top: 1px solid var(--el-border-color);
  margin-top: 20px;
}
.progress article {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--el-border-color);
  padding: 10px 0;
}
.progress p {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.8;
}
.progress .el-input,
.progress .el-select {
  margin: 8px 0;
}
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 12px 0;
}
.two label {
  font-size: 12px;
  display: grid;
  gap: 6px;
}
.actions {
  display: flex;
  gap: 10px;
  margin: 14px 0;
}
</style>
