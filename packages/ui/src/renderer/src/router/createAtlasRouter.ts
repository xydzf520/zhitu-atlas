import type { Component } from 'vue'
import {
  createRouter,
  createWebHashHistory,
  isNavigationFailure,
  NavigationFailureType,
  type RouterHistory,
  type RouteRecordRaw
} from 'vue-router'
import { PRODUCT_NAME } from '../../../common/brand'
import {
  atlasBookmarkPaths,
  atlasPageTitle,
  atlasRoutePrefix,
  resolveAtlasNavigation,
  type AtlasPage
} from '../../../common/navigation'

const pages: Record<AtlasPage, NonNullable<RouteRecordRaw['component']>> = {
  CareerDashboard: () => import('../page/MainLayout/CareerDashboard.vue'),
  CareerInsights: () => import('../page/MainLayout/CareerInsights.vue'),
  CareerDiscovery: () => import('../page/MainLayout/CareerDiscovery.vue'),
  CareerBoss: () => import('../page/MainLayout/CareerBoss.vue'),
  CareerWorkspace: () => import('../page/MainLayout/CareerWorkspace.vue'),
  CareerTasks: () => import('../page/MainLayout/CareerTasks.vue'),
  CareerAgents: () => import('../page/MainLayout/CareerAgents.vue'),
  CareerSettings: () => import('../page/MainLayout/CareerSettings.vue')
}

export function createAtlasRouter(
  layout: Component,
  history: RouterHistory = createWebHashHistory()
) {
  const home = atlasRoutePrefix + 'CareerDashboard'
  const children: RouteRecordRaw[] = [
    ...Object.entries(pages).map(([path, component]) => ({ path, component })),
    ...atlasBookmarkPaths.map((path) => ({
      path,
      redirect: (to: {
        path: string
        query: Parameters<typeof resolveAtlasNavigation>[1]
        hash: string
      }) => resolveAtlasNavigation(to.path, to.query, to.hash) || home
    }))
  ]
  const router = createRouter({
    history,
    routes: [
      { path: '/', redirect: home },
      { path: '/main-layout', component: layout, children },
      { path: '/:pathMatch(.*)*', redirect: home }
    ]
  })
  router.beforeEach((to) => resolveAtlasNavigation(to.path, to.query, to.hash) || true)
  router.afterEach((to, _from, failure) => {
    // Hash navigation already changed the address. Vue Router treats a second
    // bookmark for the same target as duplicated, so normalize only that case.
    // Cancelled draft-protection navigation must never be forced through.
    if (
      isNavigationFailure(failure, NavigationFailureType.duplicated) &&
      to.redirectedFrom &&
      resolveAtlasNavigation(
        to.redirectedFrom.path,
        to.redirectedFrom.query,
        to.redirectedFrom.hash
      ) &&
      history.location !== to.fullPath
    )
      history.replace(to.fullPath)
    if (!failure && typeof document !== 'undefined')
      document.title = `${atlasPageTitle(to.path, to.query)} - ${PRODUCT_NAME}`
  })
  return router
}
