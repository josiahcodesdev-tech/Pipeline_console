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

/**
 * What a username may be made of.
 *
 * A whitelist, not a list of dangerous inputs to reject: guessing every way a
 * script can be written is a losing game, whereas saying what a handle is made
 * of is not. Angle brackets, quotes, spaces and semicolons are all refused by
 * never appearing here.
 *
 * Nothing downstream renders this value as HTML — React escapes what it
 * renders, and the field's only destination is Supabase's sign-in call, which
 * rejects a malformed address on its own. The check earns its place by saying
 * so at the field instead of returning "Invalid login credentials" from the
 * API, which reads as a wrong password rather than a malformed username.
 */
const USERNAME = /^[a-z0-9][a-z0-9._+-]*$/i

/** The shape an address must have before it is worth sending anywhere. */
const EMAIL = /^[a-z0-9][a-z0-9._+-]*@[a-z0-9-]+(\.[a-z0-9-]+)+$/i

/** RFC 5321's limit on an address, and a generous ceiling for a handle. */
const MAX_IDENTIFIER = 254

/** A readable complaint about what was typed, or null when it is usable. */
export function signInProblem(input: string): string | null {
  const value = input.trim()
  if (!value) return 'Enter your username or email address.'
  if (value.length > MAX_IDENTIFIER) return 'That is too long to be a username or email address.'
  const valid = value.includes('@') ? EMAIL.test(value) : USERNAME.test(value)
  return valid
    ? null
    : 'Use your username or email address — letters, numbers, and . _ + - only.'
}

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
