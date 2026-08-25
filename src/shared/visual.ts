import type { VisualDescriptor } from './types'

const COLOR_ALIASES: Record<string, string[]> = {
  red: ['red', '红', '红色'],
  orange: ['orange', '橙', '橙色'],
  yellow: ['yellow', '黄', '黄色'],
  green: ['green', '绿', '绿色'],
  cyan: ['cyan', '青', '青色', '蓝绿色'],
  blue: ['blue', '蓝', '蓝色'],
  purple: ['purple', 'violet', '紫', '紫色'],
  pink: ['pink', 'magenta', '粉', '粉色', '洋红'],
  black: ['black', '黑', '黑色'],
  white: ['white', '白', '白色'],
  gray: ['gray', 'grey', '灰', '灰色']
}

export function visualColorTerms(query: string) {
  const lower = query.toLowerCase()
  return Object.entries(COLOR_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => lower.includes(alias.toLowerCase())))
    .map(([name]) => name)
}

export function visualDescriptorText(value?: VisualDescriptor) {
  if (!value) return ''
  return [
    ...(value.dominantColors || []),
    value.isDark ? 'dark' : 'bright',
    value.aspectRatio > 1.4 ? 'landscape wide' : value.aspectRatio < .72 ? 'portrait tall' : 'square',
    value.edgeDensity > .22 ? 'dense detailed' : 'simple sparse'
  ].join(' ')
}

export function visualQueryScore(query: string, value?: VisualDescriptor) {
  if (!value) return 0
  const colors = visualColorTerms(query)
  if (!colors.length) return 0
  const present = new Set(value.dominantColors || [])
  return colors.filter((color) => present.has(color)).length / colors.length
}
