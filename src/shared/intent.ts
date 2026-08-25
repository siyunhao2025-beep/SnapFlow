import type { IntentResult, IntentType } from './types'

export const actionMap: Record<IntentType, string[]> = {
  programming_error: ['解释错误', '修复代码', '提取错误', '搜索解决方案'],
  code: ['解释代码', '找 Bug', '优化', '提取代码'],
  paper: ['总结', '解释', '翻译', '检查论证', '查找原论文'],
  scientific_figure: ['读图', '解释趋势', '提取数字', '检查异常', 'Figure Description'],
  chart: ['读图', '解释趋势', '提取数字', '检查异常'],
  table: ['解释表格', '统计', '找异常', '提取数据', '生成公式'],
  excel: ['解释表格', '统计', '找异常', '提取数据', '生成公式'],
  webpage: ['总结', '解释', '翻译', '搜索来源'],
  equation: ['解释公式', '识别符号', '推导', '检查量纲'],
  pdf: ['总结', '解释', '翻译', '定位关键内容'],
  software_ui: ['解释界面', '下一步怎么做', '识别按钮', '排查问题'],
  translation: ['翻译', '提取文字', '术语解释'],
  document: ['总结', '解释', '翻译', '提取重点'],
  general: ['解释', '总结', '提取文字', '问 AI'],
  unknown: ['解释', '提取文字', '问 AI', '更多']
}

export function heuristicIntent(appName: string, windowTitle: string): IntentResult {
  const text = `${appName} ${windowTitle}`.toLowerCase()
  let type: IntentType = 'unknown'
  // This first-pass router only sees application/window metadata. Keep it conservative,
  // but prioritize explicit content clues over the hosting application name.
  if (/traceback|\berror\b|exception|failed|失败|报错/.test(text)) type = 'programming_error'
  else if (/equation|formula|integral|derivative|matrix equation|公式|方程|积分|微分/.test(text)) type = 'equation'
  else if (/translate|translation|translator|翻译/.test(text)) type = 'translation'
  else if (/excel|spreadsheet|numbers/.test(text)) type = 'excel'
  else if (/acrobat|\.pdf\b|pdf /.test(text)) type = 'pdf'
  else if (/matlab|origin|graphpad|\bplot\b|\bfigure\b/.test(text)) type = 'chart'
  else if (/settings|control panel|preferences|设置/.test(text)) type = 'software_ui'
  else if (/pycharm|visual studio|vscode|terminal|powershell|cmd|code\.exe/.test(text)) type = 'code'
  else if (/word|pages|document/.test(text)) type = 'document'
  else if (/chrome|edge|firefox|safari/.test(text)) type = 'webpage'
  return {
    type,
    language: 'unknown',
    confidence: type === 'unknown' ? 0.2 : 0.4,
    ocrText: '',
    summary: windowTitle || appName || 'Screenshot',
    actions: actionMap[type],
    tags: [type]
  }
}
