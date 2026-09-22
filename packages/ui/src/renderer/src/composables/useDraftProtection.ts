import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessageBox } from 'element-plus'
export function useDraftProtection(dirty: Readonly<Ref<boolean>>, save: () => Promise<boolean>, label = '当前资料') {
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (dirty.value) { event.preventDefault(); event.returnValue = '' }
  }
  onMounted(() => window.addEventListener('beforeunload', beforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
  onBeforeRouteLeave(async () => {
    if (!dirty.value) return true
    try {
      await ElMessageBox.confirm(`${label}有未保存的修改，保存成功后再切换页面。`, '保留你的修改', { confirmButtonText: '保存并离开', cancelButtonText: '继续编辑', closeOnClickModal: false, type: 'warning' })
      return await save()
    } catch { return false }
  })
}
