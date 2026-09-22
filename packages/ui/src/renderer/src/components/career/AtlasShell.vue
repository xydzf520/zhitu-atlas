<template>
  <div class="atlas-shell">
    <aside class="atlas-sidebar" aria-label="主导航">
      <RouterLink class="atlas-brand" :aria-label="PRODUCT_NAME" to="/main-layout/CareerDashboard">
        <img :src="mark" alt="" width="38" height="38" />
        <span>{{ PRODUCT_NAME }}<small>CAREER WORKSPACE</small></span>
      </RouterLink>
      <div class="atlas-navigation">
        <div class="atlas-nav-caption">我的求职空间</div>
        <nav class="atlas-primary-nav">
          <RouterLink
            v-for="item in items"
            :key="item.label"
            :to="item.to"
            :aria-label="item.label"
            :class="{ selected: isActive(item.to) }"
            :aria-current="isActive(item.to) ? 'page' : undefined"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              aria-hidden="true"
            >
              <path :d="item.icon" stroke-linejoin="round" stroke-linecap="round" />
            </svg>
            <span>{{ item.label }}</span>
          </RouterLink>
        </nav>
      </div>
      <footer class="atlas-sidebar-footer">
        <div class="atlas-runtime">
          <i />{{ mode === 'desktop' ? '桌面工作台' : '网页工作台' }}<span>本机存储</span>
        </div>
        <AtlasReleaseNotes />
        <slot name="footer" />
      </footer>
    </aside>
    <div class="atlas-content"><slot /></div>
  </div>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import { useRoute } from 'vue-router'
import { PRODUCT_NAME } from '../../../../common/brand'
import mark from '../../assets/atlas-mark.svg'
import AtlasReleaseNotes from './AtlasReleaseNotes.vue'
const props = defineProps<{ mode: 'desktop' | 'web' }>()
provide('atlas-runtime', props.mode)
const route = useRoute()
const items = [
  {
    label: '全景总览',
    to: '/main-layout/CareerDashboard',
    icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'
  },
  { label: '全局分析', to: '/main-layout/CareerInsights', icon: 'M3 21h18M6 17V9M12 17V3M18 17v-6' },
  {
    label: '机会发现',
    to: '/main-layout/CareerDiscovery',
    icon: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM15 15l6 6M7 10h6M10 7v6'
  },
  {
    label: '企业与进展',
    to: '/main-layout/CareerDashboard?view=companies',
    icon: 'M4 21V4h10v17M14 10h6v11M8 8h2M8 12h2M8 16h2M2 21h20'
  },
  {
    label: '沟通中心',
    to: '/main-layout/CareerDashboard?view=replies',
    icon: 'M21 11a8 8 0 0 1-8 8H6l-4 3V11a8 8 0 0 1 8-8h3a8 8 0 0 1 8 8ZM7 9h9M7 13h6'
  },
  {
    label: 'BOSS 工作台',
    to: '/main-layout/CareerBoss',
    icon: 'M3 4h18v16H3zM3 8h18M7 6h.01M10 6h.01M8 12h8M8 16h5'
  },
  {
    label: '简历与资料',
    to: '/main-layout/CareerWorkspace',
    icon: 'M6 3h9l4 4v14H5V3h1M14 3v5h5M9 12h6M9 16h6'
  },
  {
    label: '任务中心',
    to: '/main-layout/CareerTasks',
    icon: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h4'
  },
  { label: 'Agent 管理', to: '/main-layout/CareerAgents', icon: 'M8 3h8v4H8zM5 10h14v11H5zM8 14h.01M16 14h.01M9 18h6M12 7v3M2 13v5M22 13v5' },
  {
    label: '设置',
    to: '/main-layout/CareerSettings',
    icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM10 3h4l1 3 3 1 3 3v4l-3 3-3 1-1 3h-4l-1-3-3-1-3-3v-4l3-3 3-1 1-3Z'
  }
]
function isActive(to: string) {
  const [path, query = ''] = to.split('?')
  return (
    route.path === path &&
    (!path.endsWith('CareerSettings') ||
      (route.query.section || '') === (new URLSearchParams(query).get('section') || '')) &&
    (!path.endsWith('CareerDashboard') ||
      (route.query.view || 'overview') === (new URLSearchParams(query).get('view') || 'overview'))
  )
}
</script>

<style scoped>
.atlas-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--atlas-bg);
  color: var(--el-text-color-primary);
  font-family: var(--sans-serif-font-family);
}
.atlas-sidebar {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 218px;
  flex-shrink: 0;
  background: var(--atlas-panel);
  border-right: 1px solid var(--el-border-color);
  padding: 28px 16px 18px;
}
.atlas-brand {
  display: flex;
  align-items: center;
  gap: 11px;
  margin: 0 3px 32px;
  color: var(--el-color-primary);
  font-size: 16px;
  font-weight: 650;
  white-space: nowrap;
}
.atlas-brand img {
  flex-shrink: 0;
}
.atlas-brand small {
  display: block;
  margin-top: 7px;
  letter-spacing: 1.7px;
  font-size: 8px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}
.atlas-navigation {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
}
.atlas-nav-caption {
  font-size: 10px;
  color: var(--el-text-color-secondary);
  letter-spacing: 1px;
  margin: 0 12px 10px;
}
.atlas-primary-nav a {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 42px;
  box-sizing: border-box;
  padding: 10px 12px;
  margin: 4px 0;
  border-radius: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  transition:
    background 0.15s,
    color 0.15s;
}
.atlas-primary-nav svg {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}
.atlas-primary-nav a:hover {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}
.atlas-primary-nav a.selected {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  box-shadow: inset 2px 0 rgba(30, 55, 90, 0.08);
}
.atlas-tools summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  list-style: none;
  cursor: pointer;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  padding: 4px 10px 12px;
}
.atlas-tools summary::-webkit-details-marker {
  display: none;
}
.atlas-tools[open] summary span {
  transform: rotate(180deg);
}
.atlas-tools {
  margin-top: 23px;
  border-top: 1px solid var(--el-border-color);
  padding-top: 14px;
}
.atlas-sidebar-footer {
  font-size: 10px;
  color: var(--el-text-color-secondary);
  line-height: 1.7;
  padding: 15px 4px 0;
  border-top: 1px solid var(--el-border-color);
  margin-top: 14px;
}
.atlas-sidebar-footer p {
  font-size: 10px;
  margin: 8px 0;
}
.atlas-runtime {
  display: flex;
  align-items: center;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  gap: 6px;
}
.atlas-runtime i {
  background: var(--el-color-success);
  width: 5px;
  height: 5px;
  border-radius: 50%;
}
.atlas-runtime span {
  margin-left: auto;
  color: var(--el-text-color-secondary);
  font-size: 9px;
}
.atlas-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.atlas-tools:deep(.group-title) {
  font-size: 10px;
  letter-spacing: 0.8px;
  color: var(--el-text-color-secondary);
  margin: 10px 12px 6px;
}
.atlas-tools:deep(.link-list a) {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  height: 34px;
  border-radius: 6px;
  padding: 0 12px;
  margin: 1px 0;
  box-shadow: none;
  font-weight: 400;
}
.atlas-tools:deep(.link-list a:hover) {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}
.atlas-tools:deep(.link-list a.router-link-active) {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.atlas-tools:deep(.group-item + .group-item) {
  margin-top: 16px;
}
.atlas-tools:deep(svg) {
  opacity: 0.7;
}
@media (max-width: 1050px) {
  .atlas-sidebar {
    width: 192px;
    padding: 24px 12px 16px;
  }
  .atlas-brand {
    font-size: 14px;
    gap: 8px;
  }
  .atlas-brand img {
    width: 32px;
    height: 32px;
  }
  .atlas-primary-nav a {
    font-size: 11px;
    gap: 9px;
  }
}
@media (max-width: 650px) {
  .atlas-sidebar {
    width: 64px;
    padding: 18px 8px;
  }
  .atlas-brand {
    margin: 0 auto 25px;
    justify-content: center;
  }
  .atlas-brand span,
  .atlas-primary-nav span,
  .atlas-nav-caption,
  .atlas-sidebar-footer,
  .atlas-tools {
    display: none;
  }
  .atlas-primary-nav a {
    justify-content: center;
    padding: 13px 8px;
  }
  .atlas-primary-nav svg {
    width: 22px;
    height: 22px;
  }
}
</style>
