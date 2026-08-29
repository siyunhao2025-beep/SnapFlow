import { useEffect } from 'react'

const HIDDEN_SECTION_HEADINGS = [
  'skill marketplace',
  '技能市场',
  'learned workflow',
  '工作流建议',
  'developer / billing extension',
  '扩展功能',
  'advanced features'
]

const HIDDEN_ROW_LABELS = [
  'skill marketplace',
  'learned workflow 建议',
  'learned workflow suggestions'
]

function containsAny(value: string, needles: string[]) {
  const normalized = value.trim().toLowerCase()
  return needles.some((needle) => normalized.includes(needle))
}

function attachHelp(owner: HTMLElement, source: HTMLElement | null) {
  if (!source || source.classList.contains('ui-help-source')) return
  const help = source.textContent?.replace(/\s+/g, ' ').trim()
  if (!help) return
  owner.dataset.help = help
  source.classList.add('ui-help-source')
}

function polishUi() {
  document.querySelectorAll<HTMLElement>('.side-card').forEach((card) => {
    const heading = card.querySelector<HTMLElement>('header b')?.textContent || ''
    if (containsAny(heading, HIDDEN_SECTION_HEADINGS)) {
      card.classList.add('ui-pruned')
      return
    }
    attachHelp(card, card.querySelector<HTMLElement>(':scope > p'))
  })

  document.querySelectorAll<HTMLElement>('.provider-guide').forEach((card) => card.classList.add('ui-pruned'))

  document.querySelectorAll<HTMLElement>('.check-row').forEach((row) => {
    const label = row.textContent || ''
    if (containsAny(label, HIDDEN_ROW_LABELS)) row.classList.add('ui-pruned')
  })

  document.querySelectorAll<HTMLElement>('.skill-button').forEach((button) => {
    attachHelp(button, button.querySelector<HTMLElement>('small'))
  })

  document.querySelectorAll<HTMLElement>('.route-preview').forEach((preview) => {
    attachHelp(preview, preview.querySelector<HTMLElement>('span'))
  })

  document.querySelectorAll<HTMLElement>('.thread-banner').forEach((banner) => {
    attachHelp(banner, banner.querySelector<HTMLElement>('span'))
  })
}

export function UiPolish() {
  useEffect(() => {
    polishUi()
    const observer = new MutationObserver(() => polishUi())
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  return null
}
