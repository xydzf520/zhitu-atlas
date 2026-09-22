<template>
  <section class="map-settings" aria-label="地图设置">
    <h2>连接天地图</h2>
    <p>使用全国底图、地名和境界服务。配置后可切换城市，查看企业位置与地区分布。</p>
    <p>未配置时，地区筛选和地址列表仍可使用。地图需要联网，不随客户端提供离线底图。</p>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ol>
      <li><a :href="mapProvider.console" target="_blank" rel="noreferrer">前往天地图控制台</a>，注册并按服务要求创建应用。</li>
      <li>申请支持 WMTS 请求的服务权限，核对账号配额与使用条件。当前请求由本机后台发起。</li>
      <li>将自己的 Key 填在下方，保存后测试连接。<a :href="mapProvider.documentation" target="_blank" rel="noreferrer">官方接入说明</a></li>
    </ol>
    <form v-if="state" @submit.prevent="save()">
      <label>天地图 Key
        <input v-model="key" type="password" autocomplete="new-password" :placeholder="state.hasKey ? '已保存；留空保留原值' : '粘贴自己的 Key'" />
      </label>
      <label class="check"><input v-model="termsAccepted" type="checkbox" />我已核对自己的应用权限、配额及服务使用条件</label>
      <label class="check"><input v-model="enabled" type="checkbox" />启用在线地图</label>
      <p class="muted">Key 仅保存在本机私有目录，不返回页面、不写入业务备份。后台只向地图服务发送 Key 和当前视野的瓦片编号，不发送简历或企业名称。</p>
      <div class="actions">
        <ElButton type="primary" native-type="submit" :loading="busy">保存配置</ElButton>
        <ElButton :disabled="busy || dirty || !state.configured" @click="test">测试连接</ElButton>
        <ElButton :disabled="busy" @click="load">重新读取</ElButton>
        <ElButton v-if="state.hasKey" :disabled="busy" @click="clear">移除 Key</ElButton>
      </div>
      <p v-if="dirty" class="muted">有未保存的修改，保存后可测试连接。</p>
      <p role="status">{{ message }}</p>
    </form>
    <p v-else role="status">正在读取本机配置…</p>
  </section>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElButton, ElAlert, ElMessageBox } from 'element-plus'
import { mapProvider } from '../../../../common/map-provider'
const state = ref<any>(), key = ref(''), enabled = ref(false), termsAccepted = ref(false), busy = ref(false), error = ref(''), message = ref('')
const dirty = computed(() => !!state.value && (!!key.value || enabled.value !== state.value.enabled || termsAccepted.value !== state.value.termsAccepted))
async function load() {
  try {
    state.value = await electron.ipcRenderer.invoke('career-map-settings')
    key.value = ''; enabled.value = state.value.enabled; termsAccepted.value = state.value.termsAccepted; error.value = ''
  } catch (e) { error.value = String(e) }
}
async function save(clearKey = false) {
  busy.value = true; error.value = ''; message.value = ''
  try {
    state.value = await electron.ipcRenderer.invoke('career-map-settings-save', {
      revision: state.value.revision, key: key.value, enabled: clearKey ? false : enabled.value,
      termsAccepted: termsAccepted.value, clearKey
    })
    key.value = ''; enabled.value = state.value.enabled; termsAccepted.value = state.value.termsAccepted
    message.value = clearKey ? 'Key 已移除，在线地图已停用' : '已保存到本机'
    window.dispatchEvent(new Event('atlas-map-settings-changed'))
  } catch (e) { error.value = String(e) } finally { busy.value = false }
}
async function clear() {
  try { await ElMessageBox.confirm('移除后在线地图停止加载，地址记录会保留。', '移除地图 Key'); await save(true) } catch {}
}
async function test() {
  busy.value = true; error.value = ''; message.value = '正在检查三种地图图层…'
  try { message.value = (await electron.ipcRenderer.invoke('career-map-test')).message }
  catch (e) { error.value = String(e); message.value = '' } finally { busy.value = false }
}
const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty.value) { e.preventDefault(); e.returnValue = '' } }
onBeforeRouteLeave(async () => { if (!dirty.value) return true; try { await ElMessageBox.confirm('地图配置尚未保存，离开后本次修改会丢失。', '离开页面？'); return true } catch { return false } })
onMounted(() => { void load(); window.addEventListener('beforeunload', beforeUnload) })
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
</script>
<style scoped>
.map-settings{max-width:850px;padding:24px;background:var(--atlas-panel);border:1px solid var(--el-border-color);border-radius:12px}h2{margin:0 0 12px}p,li{line-height:1.8;color:var(--el-text-color-secondary)}li{margin:8px 0}a{color:var(--el-color-primary)}label{display:flex;flex-direction:column;gap:8px;margin:18px 0}input[type=password]{max-width:500px;padding:10px 12px;border:1px solid var(--el-border-color);border-radius:8px;background:var(--atlas-panel);color:inherit;font:inherit}.check{flex-direction:row;align-items:center}.actions{display:flex;flex-wrap:wrap;gap:8px}.actions .el-button{margin:0}.muted{font-size:12px}
</style>
