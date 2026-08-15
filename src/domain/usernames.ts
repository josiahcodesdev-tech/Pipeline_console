/**
 * Signing in with a username instead of an email address.
 *
 * Supabase authenticates on email and has no concept of a username, so a short
 * name has to become an address before it reaches the API. Rather than keep a
 * lookup table — which the sign-in page could not read anyway, since nobody is
 * signed in yet — a name without an "@" is completed with the organisation's
 * domain. "admin" is admin@vantageafricaleaders.com, and always the same one.
 *
 * Anything already containing "@" is left exactly as typed, so the members who
 * sign in with a real address are unaffected.
 */
const ORGANISATION_DOMAIN = 'vantageafricaleaders.com'

export function toSignInEmail(input: string): string {
  const value = input.trim()
  if (!value) return ''
  return value.includes('@')
    ? value.toLowerCase()
    : `${value.toLowerCase()}@${ORGANISATION_DOMAIN}`
}

/**
 * The reverse, for display. Shows "admin" rather than the full address when the
 * account sits on the organisation's own domain, and the whole address
 * otherwise — a gmail member should see their gmail.
 */
export function toDisplayName(email: string): string {
  const value = email.trim().toLowerCase()
  const suffix = `@${ORGANISATION_DOMAIN}`
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value
}
