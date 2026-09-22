<template>
  <details class="policy-editor" :open="route.query.settings === '1' || route.query.strategy === '1'">
    <summary>求职策略 · 统一方向与预算 <span v-if="dirty">（有未保存修改）</span></summary>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="form">
      <p>策略 v{{ form.version }} · 资料、推荐、自动联系共用。AI 只调整扩展词与软排序。</p>
      <div class="policy-grid">
        <label>目标岗位（逗号分隔）<ElInput v-model="roles" aria-label="统一目标岗位" /></label>
        <label>目标城市<ElSelect v-model="selectedCities" multiple filterable allow-create :multiple-limit="10" placeholder="搜索城市" aria-label="统一城市"><ElOption v-for="c in recruitmentCities" :key="c.code" :label="c.name" :value="c.name" /></ElSelect></label>
        <label>月薪底线 K<ElInputNumber v-model="form.direction.minimumMonthlyK" :min="1" :max="1000" aria-label="月薪底线" /></label>
        <label class="wide">核心搜索词（最多六个，AI 不修改）<ElInput v-model="keywords" aria-label="核心搜索词" /></label>
        <label>每日候选上限<ElInputNumber v-model="form.discovery.maxJobs" :min="1" :max="60" /></label>
        <label>每日详情上限<ElInputNumber v-model="form.discovery.detailLimit" :min="1" :max="40" /></label>
        <label>每日自动分析调用<ElInputNumber v-model="form.discovery.aiLimit" :min="0" :max="30" /></label>
        <label>每天推荐时间<input type="time" v-model="form.discovery.recommendTime" min="09:00" max="20:59" /></label>
        <label><ElSwitch v-model="form.discovery.autoRecommend" />每日主动挖掘</label>
        <label><ElSwitch v-model="form.discovery.adaptive" />每天最多一次 AI 搜索复盘</label>
        <label class="wide">排除公司（逗号分隔）<ElInput v-model="companies" /></label>
        <label class="wide">排除词（逗号分隔）<ElInput v-model="terms" /></label>
      </div>
      <p>当前扩展词：{{ form.discovery.extensionKeywords.join('、') || '暂无，等待 AI 根据证据提出建议' }}</p>
      <details><summary>保留的高级筛选与迁移差异</summary><p v-for="c in form.conflicts" :key="c.field">{{ c.reason }}</p><p>保留原始组合与正则；无法自动执行的规则标为待核实，不自动放宽。</p><ElInput type="textarea" v-model="advanced" :rows="8" aria-label="高级筛选 JSON" /></details>
      <div class="actions"><ElButton type="primary" :loading="saving" :disabled="!dirty" @click="save">保存统一策略</ElButton><ElButton :disabled="saving" @click="load">重新读取已保存版本</ElButton><span role="status">{{ notice }}</span></div>
    </template><p v-else>正在读取统一策略…</p>
  </details>
</template>
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElAlert, ElButton, ElInput, ElInputNumber, ElSwitch, ElSelect, ElOption } from 'element-plus'
import { recruitmentCities } from '../../../../common/regions'
import { useDraftProtection } from '../../composables/useDraftProtection'
const emit=defineEmits(['saved']),route=useRoute(),form=ref<any>(),revision=ref(''),baseline=ref(''),roles=ref(''),cities=ref(''),keywords=ref(''),companies=ref(''),terms=ref(''),advanced=ref(''),error=ref(''),notice=ref(''),saving=ref(false)
const list=(s:string)=>[...new Set(s.split(/[,，\n]/).map(v=>v.trim()).filter(Boolean))]
const selectedCities=computed({get:()=>list(cities.value),set:(values:string[])=>{cities.value=values.join('，')}})
const draft=()=>({form:form.value,roles:roles.value,cities:cities.value,keywords:keywords.value,companies:companies.value,terms:terms.value,advanced:advanced.value})
const dirty=computed(()=>!!baseline.value && JSON.stringify(draft())!==baseline.value)
async function load(){try{const r=await electron.ipcRenderer.invoke('career-policy-load');form.value=r.value;revision.value=r.revision;roles.value=r.value.direction.targetRoles.join('，');cities.value=r.value.direction.preferredCities.join('，');keywords.value=r.value.discovery.coreKeywords.join('，');companies.value=r.value.exclusions.companies.join('，');terms.value=r.value.exclusions.terms.join('，');advanced.value=JSON.stringify(r.value.advanced,null,2);baseline.value=JSON.stringify(draft());error.value=''}catch(e){error.value=String(e)}}
async function save(){saving.value=true;error.value='';try{const value=JSON.parse(JSON.stringify(form.value));value.direction={targetRoles:list(roles.value),preferredCities:list(cities.value),minimumMonthlyK:form.value.direction.minimumMonthlyK ?? null};value.discovery.coreKeywords=list(keywords.value);value.discovery.extensionKeywords=value.discovery.extensionKeywords.filter((v:string)=>!value.discovery.coreKeywords.includes(v)).slice(0,Math.max(0,6-value.discovery.coreKeywords.length));value.exclusions={companies:list(companies.value),terms:list(terms.value)};value.advanced=JSON.parse(advanced.value);await electron.ipcRenderer.invoke('career-policy-save',{value,baseRevision:revision.value});await load();notice.value='已保存，各入口立即使用同一策略';emit('saved');return true}catch(e){error.value=String(e);return false}finally{saving.value=false}}
useDraftProtection(dirty,save,'统一求职策略');onMounted(load)
</script>
<style scoped>
.policy-editor{border-top:1px solid var(--el-border-color);padding:18px 0;margin-top:18px;font-size:13px}.policy-editor summary{cursor:pointer;color:var(--el-color-primary);font-weight:600;padding:8px 0}.policy-editor p{color:var(--el-text-color-secondary);line-height:1.8}.policy-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin:20px 0}.policy-grid label{display:flex;flex-direction:column;gap:10px}.wide{grid-column:span 2}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px;align-items:center}.actions span{color:var(--el-color-success)}input[type=time]{padding:8px;border:1px solid var(--el-border-color);border-radius:6px;font:inherit;background:var(--atlas-panel);color:inherit}@media(max-width:850px){.policy-grid{grid-template-columns:1fr 1fr}}@media(max-width:600px){.policy-grid{grid-template-columns:1fr}.wide{grid-column:auto}}
</style>
