const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (c) => ESC[c]) }
function safeUrl(value: string) {
  try {
    const u = new URL(value, 'https://snapflow.invalid')
    if (['https:', 'http:', 'mailto:'].includes(u.protocol)) return value
  } catch {}
  return '#'
}

/**
 * Minimal, dependency-free Markdown renderer with a strict output whitelist.
 * Raw HTML is escaped before Markdown substitutions, so scripts/events cannot survive.
 */
export function renderSafeMarkdown(markdown: string) {
  const raw = escapeHtml(markdown || '')
    .replace(/\r\n?/g, '\n')
    .replace(/```([\w-]*)\n([\s\S]*?)```/g, (_m, lang, code) => `<pre><code data-lang="${escapeHtml(lang)}">${code}</code></pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => `<a href="${escapeHtml(safeUrl(href))}" target="_blank" rel="noopener noreferrer">${label}</a>`)

  const lines = raw.split('\n')
  const out: string[] = []
  let list: 'ul' | 'ol' | '' = ''
  const closeList = () => { if (list) out.push(`</${list}>`); list = '' }
  for (const line of lines) {
    if (/^<pre>/.test(line)) { closeList(); out.push(line); continue }
    const h = line.match(/^(#{1,3})\s+(.+)/)
    if (h) { closeList(); out.push(`<h${h[1].length}>${h[2]}</h${h[1].length}>`); continue }
    const ul = line.match(/^\s*[-*]\s+(.+)/)
    if (ul) { if (list !== 'ul') { closeList(); list = 'ul'; out.push('<ul>') } out.push(`<li>${ul[1]}</li>`); continue }
    const ol = line.match(/^\s*\d+[.)]\s+(.+)/)
    if (ol) { if (list !== 'ol') { closeList(); list = 'ol'; out.push('<ol>') } out.push(`<li>${ol[1]}</li>`); continue }
    closeList()
    if (line.trim()) out.push(`<p>${line}</p>`)
  }
  closeList()
  return out.join('')
}

export function stripUnsafeHtml(input: string) {
  return renderSafeMarkdown(input).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
