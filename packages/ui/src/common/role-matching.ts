/** Conservative title aliases, not a list of allowed occupations. Unknown roles remain reviewable. */
const families: Array<[string, RegExp]> = [
  ['backend', /后端|服务端|\bback[ -]?end\b|\bserver[ -]?side\b/i],
  ['frontend', /前端|\bfront[ -]?end\b/i],
  ['fullstack', /全栈|\bfull[ -]?stack\b/i],
  ['mobile', /客户端|移动开发|安卓|android|\bios\b|app开发/i],
  ['testing', /软件测试|测试工程师|测试开发|质量保证|\bqa\b|\bsdet\b|quality assurance/i],
  ['algorithm', /算法|机器学习|深度学习|模型研发|machine learning|data scientist/i],
  ['data', /数据分析|商业分析|数据科学|data analyst|business analyst/i],
  ['infrastructure', /运维|云平台|基础架构|\bsre\b|devops/i],
  ['hardware', /硬件工程|电路设计|hardware engineer/i],
  ['embedded', /嵌入式|固件开发|embedded|firmware/i],
  [
    'design',
    /交互设计|用户体验设计|视觉设计|界面设计|ui设计|ux设计|\b(?:ui|ux|product) designer\b/i
  ],
  ['operations', /运营|operations specialist|operations manager/i],
  ['product', /产品(?!运营|设计|开发|销售|测试|生产)|\bproduct (?:manager|owner|director|lead)\b/i],
  ['sales', /销售|商务拓展|客户经理|account executive|sales|business development/i],
  ['finance', /财务|会计|审计|accountant|auditor|finance/i],
  ['hr', /人力资源|招聘专员|招聘经理|hrbp|human resources|recruiter/i],
  ['supply', /供应链|采购|物流|supply chain|procurement|logistics/i],
  ['teaching', /教师|老师|教研|teacher/i],
  ['nursing', /护士|护理|nurse/i]
]
const normalize = (s: string) => s.toLowerCase().replace(/[\s·\-_/（）()]/g, '')
const family = (title: string) => families.find(([, pattern]) => pattern.test(title))?.[0]
export function roleAlignment(title: string, targets: string[]) {
  const wanted = targets.filter((t) => t.trim())
  if (!title.trim() || !wanted.length)
    return { status: 'unknown' as const, reason: '目标岗位或职位名称待补充' }
  if (wanted.some((t) => normalize(title).includes(normalize(t))))
    return { status: 'matched' as const, reason: '职位名称与本人目标岗位一致' }
  const actual = family(title),
    expected = wanted.map(family)
  if (actual && expected.includes(actual))
    return {
      status: 'matched' as const,
      reason: '职位名称属于目标职业方向；细分职责与资历仍需核对'
    }
  if (actual && expected.every(Boolean))
    return {
      status: 'different' as const,
      reason: '职位名称属于其他职业方向，需核实是否接受跨方向机会'
    }
  return {
    status: 'unknown' as const,
    reason: '职位名称暂无法与目标方向对应，保留待核实，可补充目标岗位别名'
  }
}
