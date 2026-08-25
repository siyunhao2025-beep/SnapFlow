export function redactSensitiveText(value: string, options: { email?: boolean; phone?: boolean } = { email: true, phone: true }) {
  let result = value || ''
  if (options.email !== false) result = result.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
  if (options.phone !== false) result = result.replace(/(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)/g, '[REDACTED_PHONE]')
  return result
}
export function isSensitiveApp(appName: string, windowTitle: string, blacklist: string[]) {
  const haystack = `${appName} ${windowTitle}`.toLowerCase()
  return blacklist.some((item) => item.trim() && haystack.includes(item.trim().toLowerCase()))
}
