<template>
  <div class="ai-review">
    <div class="review-actions">
      <ElButton :disabled="!modelValue.trim()" @click="open = true">{{
        confirmed ? '查看已确认话术' : '核对并确认话术'
      }}</ElButton>
      <ElButton :disabled="!confirmed || !available" @click="copy">复制话术</ElButton>
      <span role="status">{{
        !available
          ? disabledReason
          : confirmed
            ? '已由本人确认 · 尚未发送'
            : '待本人确认 · 尚未发送'
      }}</span>
    </div>
    <ElDialog
      v-model="open"
      :title="title || '确认 AI 话术'"
      width="min(820px, calc(100vw - 32px))"
      top="6vh"
      class="atlas-ai-review-dialog"
      :close-on-click-modal="false"
    >
      <p class="review-context">{{ context }}</p>
      <p v-if="verificationError" class="review-error" role="alert">{{ verificationError }}</p>
      <p class="review-note">先核对岗位、个人经历和措辞。确认只保存本次话术，不会发送给招聘者。</p>
      <ElAlert
        v-if="!available"
        :title="disabledReason || '依据尚未核实，请稍后再确认。'"
        type="warning"
        :closable="false"
      />
      <label class="review-label">准备使用的话术</label>
      <ElInput
        :model-value="modelValue"
        @update:model-value="emit('update:modelValue', $event)"
        type="textarea"
        :rows="6"
        maxlength="1500"
        show-word-limit
        aria-label="核对 AI 话术"
      />
      <details class="review-proof" open>
        <summary>核对匹配依据</summary>
        <slot><p>请对照当前岗位和个人资料核实内容。</p></slot>
      </details>
      <ElCheckbox v-model="checked" :disabled="!available"
        >我已核对个人经历、岗位关联和表达内容</ElCheckbox
      >
      <template #footer>
        <ElButton @click="open = false">稍后再确认</ElButton>
        <ElButton
          type="primary"
          :loading="verifying"
          :disabled="!checked || !available || !modelValue.trim() || verifying"
          @click="confirm"
          >确认并保存话术</ElButton
        >
      </template>
    </ElDialog>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch, onActivated, onDeactivated } from 'vue'
import { ElAlert, ElButton, ElCheckbox, ElDialog, ElInput, ElMessage } from 'element-plus'
const props = withDefaults(
  defineProps<{
    modelValue: string
    basis: string
    confirmation?: string
    requestOpen?: boolean
    active?: boolean
    available?: boolean
    disabledReason?: string
    context?: string
    verify?: () => Promise<void>
    title?: string
  }>(),
  { active: true, available: true }
)
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'update:confirmation', value: string): void
  (e: 'opened'): void
}>()
const pageActive = ref(true)
onActivated(() => {
  pageActive.value = true
})
onDeactivated(() => {
  pageActive.value = false
  open.value = false
})
const verificationError = ref(''),
  verifying = ref(false)
const open = ref(false),
  checked = ref(false)
const signature = computed(() => JSON.stringify([props.basis, props.modelValue]))
const confirmed = computed(
  () => !!props.modelValue.trim() && props.confirmation === signature.value
)
watch(
  signature,
  () => {
    checked.value = false
    emit('update:confirmation', '')
  },
  { flush: 'sync' }
)
watch(
  () => [props.requestOpen, props.active, pageActive.value],
  () => {
    if (!props.active || !pageActive.value) {
      open.value = false
      return
    }
    if (props.requestOpen) {
      checked.value = false
      open.value = true
      emit('opened')
    }
  },
  { immediate: true }
)
watch(open, (value) => {
  if (value) checked.value = false
})
async function verifyCurrent() {
  if (verifying.value) return false
  const initial = signature.value
  verifying.value = true
  verificationError.value = ''
  try {
    await props.verify?.()
    if (initial !== signature.value || !props.available)
      throw Error('内容或依据已变化，请重新核对。')
    return true
  } catch (e) {
    emit('update:confirmation', '')
    checked.value = false
    verificationError.value = e instanceof Error ? e.message : String(e)
    open.value = true
    return false
  } finally {
    verifying.value = false
  }
}
async function confirm() {
  if (!checked.value || !props.available || !props.modelValue.trim() || !(await verifyCurrent()))
    return
  if (!open.value || !checked.value) return
  emit('update:confirmation', signature.value)
  open.value = false
  ElMessage.success('话术已确认并保存在当前窗口，尚未发送')
}
async function copy() {
  if (!confirmed.value || !props.available || !(await verifyCurrent())) return
  try {
    await electron.ipcRenderer.invoke('career-copy-text', props.modelValue)
    ElMessage.success('已复制本人确认的话术')
  } catch {
    ElMessage.error('复制失败，请在确认窗口手动选中文字复制')
  }
}
</script>
<style scoped>
.review-error {
  color: var(--el-color-danger);
}
.review-proof :deep(article) {
  border-top: 1px solid var(--el-border-color-light);
  padding: 14px 0;
}
.review-proof :deep(blockquote) {
  margin: 8px 0;
  padding: 10px 14px;
  border-left: 3px solid var(--el-color-primary-light-5);
  background: var(--el-fill-color-light);
}

.review-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.review-actions .el-button + .el-button {
  margin-left: 0;
}
.review-actions span {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.review-context {
  font-weight: 600;
  margin: 0 0 8px;
}
.review-note {
  line-height: 1.7;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.review-label {
  display: block;
  font-weight: 600;
  margin: 18px 0 10px;
}
.review-proof {
  margin: 20px 0;
  line-height: 1.8;
  font-size: 13px;
}
.review-proof summary {
  cursor: pointer;
  color: var(--el-color-primary);
  margin-bottom: 12px;
}
.ai-review :deep(.el-checkbox) {
  white-space: normal;
  height: auto;
  align-items: flex-start;
}
.ai-review :deep(.el-checkbox__label) {
  white-space: normal;
  line-height: 1.6;
}
</style>
<style>
.atlas-ai-review-dialog {
  max-height: 88vh;
  display: flex;
  flex-direction: column;
}
.atlas-ai-review-dialog .el-dialog__body {
  overflow: auto;
  min-height: 0;
}
.atlas-ai-review-dialog .el-dialog__footer {
  border-top: 1px solid var(--el-border-color-light);
  padding-top: 16px;
}
</style>
