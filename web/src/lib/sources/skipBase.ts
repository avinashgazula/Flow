/* The addresses of the two skip-time services, which the apps let a viewer point at their own deployment
   (`account.introDBBaseURL`, `account.publicMetaDBBaseURL`). Empty means the public one. */

export const introDBDefaultBase = 'https://api.introdb.app'
export const publicMetaDBDefaultBase = 'https://publicmetadb.com'

/** Why an address can't be asked, in words for the field; undefined when it can (or is empty, which means the default). */
export function baseURLProblem(value: string): string | undefined {
  const text = value.trim()
  if (!text) return undefined
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Use an address that starts with https://.'
    if (url.username || url.password) return 'Leave the login out of the address.'
    return undefined
  } catch {
    return 'That isn’t a web address. Use one like https://example.com.'
  }
}

/** The address to ask: what was typed without its trailing slashes, or the public one when it is empty or unusable. */
export function skipBase(value: string | undefined, fallback: string): string {
  const text = (value ?? '').trim()
  if (!text || baseURLProblem(text)) return fallback
  return text.replace(/\/+$/, '')
}
