<template>
  <section class="project-editor" aria-label="作品与开源项目">
    <ElButton v-if="!evidence.project" :disabled="disabled" @click="add">关联作品 / 开源项目</ElButton>
    <template v-else>
      <h4>作品与开源项目</h4>
      <p>按岗位需要引用这段经历。公开代码证明实现方式，个人贡献和业务成果仍由你核实。</p>
        <ElFormItem label="项目名称"><ElInput v-model="evidence.project.name" @input="changed" /></ElFormItem>
        <ElFormItem label="公开仓库地址"><ElInput v-model="evidence.project.url" @input="changed" placeholder="https://github.com/账号/仓库；尚未公开可留空" /></ElFormItem>
        <ElFormItem label="你实际负责什么"><ElInput v-model="evidence.project.scope" @input="changed" type="textarea" :autosize="{ minRows: 2 }" /></ElFormItem>
        <ElFormItem label="能力边界 / 尚未验收"><ElInput v-model="evidence.project.limitations" @input="changed" type="textarea" :autosize="{ minRows: 2 }" placeholder="例如：已有代码与本地测试，真实模型训练尚未验收" /></ElFormItem>
      <div class="actions">
        <ElButton :loading="busy" :disabled="disabled || dirty || !evidence.project.url" @click="verify">核实公开仓库</ElButton>
        <ElButton link type="danger" :disabled="disabled" @click="remove">取消关联</ElButton>
      </div>
      <p role="status">{{ message || (dirty ? '保存资料后可核实。仅已确认经历且仓库核实通过，话术才会按相关性附带链接。' : '核实无需 GitHub 登录，有效期 24 小时；不会自动确认个人贡献。') }}</p>
    </template>
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { ElButton, ElFormItem, ElInput } from 'element-plus'
import type { CareerEvidence } from '../../../../common/career'
const props = defineProps<{ evidence: CareerEvidence; disabled: boolean; dirty: boolean }>()
const busy = ref(false), message = ref('')
function changed() { props.evidence.confirmed = false; message.value = '' }
function add() { props.evidence.project = { name: props.evidence.title, url: '', scope: '', limitations: '' }; changed() }
function remove() { delete props.evidence.project; changed() }
async function verify() {
  busy.value = true; message.value = ''
  try {
    const snapshot = await electron.ipcRenderer.invoke('career-workspace-snapshot')
    const result = await electron.ipcRenderer.invoke('career-project-verify', { evidenceId: props.evidence.id, profileVersion: snapshot.profileVersion })
    message.value = result.reason + (result.verified ? ` · ${result.license}` : '')
  } catch (e: any) { message.value = e.message || '公开状态核实失败，请稍后重试' }
  finally { busy.value = false }
}
</script>
<style scoped>
.project-editor { margin: 12px 0; padding: 16px; border: 1px solid #dce6f4; border-radius: 10px; background: #f8faff; }
h4 { margin: 0 0 8px; } p { font-size: 13px; color: #617189; line-height: 1.7; } .actions { display: flex; gap: 10px; flex-wrap: wrap; }
</style>
