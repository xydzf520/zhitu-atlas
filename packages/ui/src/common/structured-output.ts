/** Presentation only: keep the collected source intact and never infer missing requirements. */
export interface ReadingBlock {
  kind: 'paragraph' | 'item'
  text: string
  marker?: string
}
export interface ReadingSection {
  title: string
  raw: string
  blocks: ReadingBlock[]
}
const titles = [
  '职位概述',
  '岗位概述',
  '岗位概要',
  '职位概要',
  '职位介绍',
  '岗位介绍',
  '岗位描述',
  '职位描述',
  '核心职责',
  '主要职责',
  '工作职责',
  '岗位职责',
  '职位职责',
  '工作内容',
  '职责描述',
  '任职要求',
  '任职资格',
  '岗位要求',
  '职位要求',
  '招聘要求',
  '技能要求',
  '基本要求',
  '优先条件',
  '优先考虑',
  '加分项',
  '加分条件',
  '福利待遇',
  '薪资福利',
  '工作地点',
  '工作地址',
  '关于我们',
  '公司介绍',
  '团队介绍',
  '我们提供'
]
function paragraphs(text: string): ReadingBlock[] {
  // Long unstructured paragraphs remain prose. Sentence boundaries are layout breaks, not facts.
  const lines = text
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean)
  return lines.flatMap((line) => {
    if (line.length < 240) return [{ kind: 'paragraph' as const, text: line }]
    const pieces: string[] = []
    let start = 0
    for (let i = 0; i < line.length; i++) {
      if (i - start >= 130 && /[。！？]/.test(line[i])) {
        pieces.push(line.slice(start, i + 1))
        start = i + 1
      }
    }
    if (start < line.length) pieces.push(line.slice(start))
    return pieces.map((text) => ({ kind: 'paragraph' as const, text }))
  })
}
function blocks(text: string): ReadingBlock[] {
  const markers: { start: number; end: number; label: string }[] = []
  const pattern =
    /(?:[1-9]\d?[.、．）)](?!\d)|[（(](?:[1-9]\d?|[一二三四五六七八九十]+)[）)]|[一二三四五六七八九十]+[、）]|[-*•●▪·](?=\s))/g
  let previousNumber: number | undefined
  for (const match of text.matchAll(pattern)) {
    const start = match.index!,
      before = text.slice(0, start),
      label = match[0]
    const lineStart = !before.slice(before.lastIndexOf('\n') + 1).trim()
    const numeric = label.match(/\d+/)?.[0]
    const chinese = label.match(/[一二三四五六七八九十]+/)?.[0]
    const number = numeric
      ? Number(numeric)
      : chinese
        ? ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'].indexOf(chinese) + 1
        : undefined
    const inlineBoundary = /[\s。；;！？）)\u3400-\u9fff]$/.test(before)
    const firstAfterLabel = number === 1 && /(?:[:：]\s*|\s{2,})$/.test(before)
    const inlineBullet = /^[-*•●▪·]/.test(label) && /[。；;！？]\s*$/.test(before)
    // Flattened BOSS text often loses every newline. Only extend a numbered sequence.
    if (
      !lineStart &&
      !firstAfterLabel &&
      !inlineBullet &&
      !(
        inlineBoundary &&
        number !== undefined &&
        previousNumber !== undefined &&
        number === previousNumber + 1
      )
    )
      continue
    markers.push({ start, end: start + label.length, label })
    previousNumber = number
  }
  if (!markers.length) return paragraphs(text)
  const result = paragraphs(text.slice(0, markers[0].start))
  markers.forEach((marker, i) => {
    const body = text.slice(marker.end, markers[i + 1]?.start ?? text.length).trim()
    if (body) result.push({ kind: 'item', marker: marker.label, text: body })
    else result.push({ kind: 'paragraph', text: marker.label })
  })
  return result
}
export function structureText(source: string, mode: 'job' | 'resume' = 'job'): ReadingSection[] {
  if (!source?.trim()) return []
  const boundaries: { start: number; end: number; title: string }[] = []
  const resumeTitles = [
    '个人信息',
    '基本信息',
    '个人优势',
    '核心优势',
    '个人简介',
    '求职意向',
    '工作经历',
    '工作经验',
    '任职经历',
    '项目经历',
    '项目经验',
    '教育经历',
    '教育背景',
    '学历背景',
    '专业技能',
    '技能特长',
    '核心能力',
    '职业技能',
    '专业认证'
  ]
  const pattern =
    mode === 'resume'
      ? new RegExp(
          `(^[ \t]*#{1,6}[ \t]+[^\r\n]+)|^[ \t]*(?:\\*\\*|【)?(${resumeTitles.join('|')})(?:\\*\\*|】)?[：:]?[ \t]*$`,
          'gm'
        )
      : new RegExp(`(^[ \t]*#{1,6}[ \t]+[^\r\n]+)|(?:【)?(${titles.join('|')})(?:】)?[：:]?`, 'gm')
  for (const match of source.matchAll(pattern)) {
    const start = match.index!,
      before = source.slice(0, start)
    const lineStart = !before.slice(before.lastIndexOf('\n') + 1).trim()
    const after = source.slice(start + match[0].length)
    const explicitInline =
      /[。；;！？\s]$/.test(before) && /^(?:\s*[1-9][.、．）)]|\s*[（(]1[）)])/.test(after)
    const colonHeading = /[：:]$/.test(match[0]) && /[。；;！？\s]$/.test(before)
    if (!match[1] && !lineStart && !explicitInline && !colonHeading) continue
    boundaries.push({
      start,
      end: start + match[0].length,
      title: match[1] ? match[1].replace(/^\s*#+\s+/, '') : match[2]
    })
  }
  if (!boundaries.length) return [{ title: '正文', raw: source, blocks: blocks(source) }]
  const sections: ReadingSection[] = []
  if (boundaries[0].start)
    sections.push({
      title: '正文',
      raw: source.slice(0, boundaries[0].start),
      blocks: blocks(source.slice(0, boundaries[0].start))
    })
  boundaries.forEach((heading, i) => {
    const end = boundaries[i + 1]?.start ?? source.length
    sections.push({
      title: heading.title,
      raw: source.slice(heading.start, end),
      blocks: blocks(source.slice(heading.end, end))
    })
  })
  return sections
}
export function snapshotChanges(
  current: Record<string, unknown>,
  previous?: Record<string, unknown>
): string[] {
  if (!previous) return []
  const fields = {
    jobName: '岗位名称',
    salaryDesc: '薪资',
    address: '工作地址',
    experienceName: '经验要求',
    degreeName: '学历要求',
    description: '岗位正文',
    stageName: '融资阶段'
  }
  return Object.entries(fields)
    .filter(([key]) => String(current[key] ?? '') !== String(previous[key] ?? ''))
    .map(([, title]) => title)
}
