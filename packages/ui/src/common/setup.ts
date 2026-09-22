import type { CareerProfile } from './career'
export function setupSteps(profile: CareerProfile, configured: boolean, connected: boolean) {
  return [
    {
      id: 'profile',
      title: '整理经历',
      detail: '保存简历，确认至少一项可引用的真实经历',
      done: !!profile.resumeText.trim() && profile.evidence.some((e) => e.confirmed),
      optional: false,
      to: '/main-layout/CareerWorkspace'
    },
    {
      id: 'direction',
      title: '选择方向',
      detail: '设置目标职业、城市与薪资；支持多个岗位名称',
      done: !!profile.targetRoles.length && !!profile.preferredCities.length,
      optional: false,
      to: '/main-layout/CareerDiscovery?settings=1'
    },
    {
      id: 'model',
      title: '连接模型',
      detail: 'AI 分析需要；手动管理资料和机会可以跳过',
      done: configured,
      optional: true,
      to: '/main-layout/CareerSettings?section=model'
    },
    {
      id: 'platform',
      title: '连接岗位来源',
      detail: '在桌面登录 BOSS，或在数据管理导入文件',
      done: connected,
      optional: true,
      to: '/main-layout/CareerBoss'
    }
  ]
}
export const careerExamples = [
  {
    role: '后端开发工程师',
    title: '服务端开发工程师',
    topic: '接口',
    fact: '负责订单接口与数据库性能优化，参与上线后的问题排查。'
  },
  {
    role: '运营经理',
    title: '用户运营经理',
    topic: '用户运营',
    fact: '负责用户分层、活动策划及效果复盘，与客服和销售共同改进运营流程。'
  },
  {
    role: '交互设计师',
    title: '用户体验设计师',
    topic: '交互设计',
    fact: '负责业务流程梳理、交互原型与可用性测试，协同研发推进设计交付。'
  },
  {
    role: '会计',
    title: '财务会计',
    topic: '财务',
    fact: '负责财务核算、月度结账和报表核对，配合业务部门整理费用及凭证。'
  }
]
