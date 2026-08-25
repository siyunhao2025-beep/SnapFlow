import React, { useMemo } from 'react'
import { renderSafeMarkdown } from '../../../shared/sanitize'

export function SafeMarkdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => renderSafeMarkdown(text), [text])
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
