import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { IntentType, Locale } from '../../shared/types'

type LanguageContextValue = {
  locale: Locale
  zh: boolean
  setLocale: (locale: Locale) => Promise<void>
  text: (zh: string, en: string) => string
  actionLabel: (value: string) => string
  intentLabel: (value: IntentType | string) => string
  skillName: (id: string, fallback: string) => string
  skillDescription: (id: string, fallback: string) => string
  formatDateTime: (value: string | Date) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

const ACTION_EN: Record<string, string> = {
  '解释': 'Explain', '解释错误': 'Explain error', '修复': 'Fix', '修复代码': 'Fix code',
  '提取错误': 'Extract error', '搜索解决方案': 'Search solution',
  '解释代码': 'Explain code', '找 Bug': 'Find bugs', '优化': 'Optimize', '提取代码': 'Extract code',
  '总结': 'Summarize', '翻译': 'Translate', '检查论证': 'Check argument', '查找原论文': 'Find source paper',
  '读图': 'Read figure', '解释趋势': 'Explain trend', '提取数字': 'Extract values', '检查异常': 'Check anomalies',
  '解释表格': 'Explain table', '统计': 'Statistics', '找异常': 'Find anomalies', '提取数据': 'Extract data', '生成公式': 'Generate formula',
  '搜索来源': 'Search sources', '提取文字': 'Extract text', '问 AI': 'Ask AI', '更多': 'More',
  '术语解释': 'Explain terms', '继续追问': 'Follow up',
  '解释公式': 'Explain equation', '识别符号': 'Identify symbols', '推导': 'Derive', '检查量纲': 'Check dimensions',
  '定位关键内容': 'Locate key content', '解释界面': 'Explain UI', '下一步怎么做': 'What to do next',
  '识别按钮': 'Identify controls', '排查问题': 'Troubleshoot', '提取重点': 'Extract key points',
  'Figure Description': 'Figure Description'
}

const INTENT_ZH: Record<string, string> = {
  programming_error: '程序报错', code: '代码', paper: '学术论文', scientific_figure: '科研图',
  chart: '图表', table: '表格', excel: 'Excel', webpage: '网页', equation: '公式', pdf: 'PDF',
  software_ui: '软件界面', translation: '翻译', document: '文档', general: '通用', unknown: '未识别'
}

const INTENT_EN: Record<string, string> = {
  programming_error: 'Programming Error', code: 'Code', paper: 'Scientific Paper', scientific_figure: 'Scientific Figure',
  chart: 'Chart', table: 'Table', excel: 'Excel', webpage: 'Web Page', equation: 'Equation', pdf: 'PDF',
  software_ui: 'Software UI', translation: 'Translation', document: 'Document', general: 'General', unknown: 'Unknown'
}

const SKILL_I18N: Record<string, { zhName: string; enName: string; zhDescription: string; enDescription: string }> = {
  'academic-paper': {
    zhName: '学术论文', enName: 'Academic Paper',
    zhDescription: '论文段落、方法、结果与论证边界分析',
    enDescription: 'Analyze paper text, methods, results, evidence and argument boundaries.'
  },
  debug: {
    zhName: '程序调试', enName: 'Debug',
    zhDescription: '程序报错定位、根因解释与最小修复路径',
    enDescription: 'Locate errors, explain root causes and propose the smallest verifiable fix.'
  },
  general: {
    zhName: '通用', enName: 'General',
    zhDescription: '通用截图理解与下一步操作',
    enDescription: 'General screenshot understanding and next-step actions.'
  },
  'scientific-figure-reader': {
    zhName: '科研图阅读', enName: 'Scientific Figure Reader',
    zhDescription: '科研图变量、坐标、趋势、极值、异常与证据边界分析',
    enDescription: 'Read variables, axes, trends, extrema, anomalies and evidential limits in scientific figures.'
  },
  'table-analysis': {
    zhName: '表格分析', enName: 'Table Analysis',
    zhDescription: '表格结构、统计、异常与公式建议',
    enDescription: 'Analyze table structure, statistics, anomalies and formula suggestions.'
  },
  translation: {
    zhName: '翻译', enName: 'Translation',
    zhDescription: '保留术语、公式、单位与版式层级的截图翻译',
    enDescription: 'Translate screenshot text while preserving terminology, equations, units and hierarchy.'
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('zh-CN')

  useEffect(() => {
    let alive = true
    void window.snapflow.getLocale()
      .then((value) => { if (alive) setLocaleState(value === 'en-US' ? 'en-US' : 'zh-CN') })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  async function setLocale(nextLocale: Locale) {
    const saved = await window.snapflow.setLocale(nextLocale)
    setLocaleState(saved)
  }

  const value = useMemo<LanguageContextValue>(() => ({
    locale,
    zh: locale === 'zh-CN',
    setLocale,
    text: (zhText, enText) => locale === 'zh-CN' ? zhText : enText,
    actionLabel: (raw) => locale === 'zh-CN' ? raw : (ACTION_EN[raw] || raw),
    intentLabel: (raw) => locale === 'zh-CN' ? (INTENT_ZH[raw] || raw) : (INTENT_EN[raw] || raw),
    skillName: (id, fallback) => {
      const item = SKILL_I18N[id]
      if (!item) return fallback
      return locale === 'zh-CN' ? item.zhName : item.enName
    },
    skillDescription: (id, fallback) => {
      const item = SKILL_I18N[id]
      if (!item) return fallback
      return locale === 'zh-CN' ? item.zhDescription : item.enDescription
    },
    formatDateTime: (input) => {
      const date = input instanceof Date ? input : new Date(input)
      return Number.isNaN(date.getTime()) ? String(input) : date.toLocaleString(locale)
    }
  }), [locale])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const value = useContext(LanguageContext)
  if (!value) throw new Error('LanguageProvider is missing')
  return value
}

export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLanguage()
  return (
    <div className={compact ? 'language-switch compact' : 'language-switch'} aria-label="Language / 语言">
      <button type="button" className={locale === 'zh-CN' ? 'active' : ''} onClick={() => void setLocale('zh-CN')}>中文</button>
      <button type="button" className={locale === 'en-US' ? 'active' : ''} onClick={() => void setLocale('en-US')}>EN</button>
    </div>
  )
}
