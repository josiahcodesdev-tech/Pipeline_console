/**
 * Edge Function: manage-members
 *
 * Creating an account, changing someone's role and switching their access off
 * all require the service-role key, which must never reach a browser — it
 * bypasses every row-level security policy in the project. So the super user's
 * Members page has no admin powers of its own; it asks this function, and this
 * function checks who is asking before it does anything.
 *
 * The check is deliberately made against the `profiles` table rather than the
 * caller's token. A JWT carries whatever claims it was minted with; the role
 * that governs this console lives in a table only the super user can write to,
 * and that is the one worth trusting.
 *
 * Deploy:
 *   supabase functions deploy manage-members
 *
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function text(value: unknown, limit = 320): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

const ROLES = ['super_user', 'admin', 'user'] as const
type Role = (typeof ROLES)[number]

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/**
 * A first password for a new member, to be handed over out of band.
 *
 * Generated here rather than chosen by the super user so that no account is
 * created with a password someone guessed at, and read from the CSPRNG rather
 * than Math.random. It is shown once, in the response, and never stored by this
 * console — the member changes it on first sign-in.
 */
function temporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  let out = ''
  for (const byte of bytes) out += alphabet[byte % alphabet.length]
  // Guarantees the symbol and digit that a password policy usually wants,
  // without weakening the random part.
  return `${out}-7x`
}

/** The caller, if their token is valid and they are the super user. */
async function requireSuperUser(
  request: Request,
  admin: SupabaseClient,
): Promise<{ id: string } | null> {
  const token = (request.headers.get('authorization') ?? '')
    .replace(/^Bearer\s+/i, '')
    .trim()
  if (!token) return null

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user?.id) return null

  const { data: profile } = await admin
    .from('profiles')
    .select('role, active')
    .eq('id', data.user.id)
    .maybeSingle()

  if (!profile || profile.active !== true || profile.role !== 'super_user') return null
  return { id: data.user.id }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) {
    return json({ error: 'This function is missing its Supabase credentials.' }, 500)
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const caller = await requireSuperUser(request, admin)
  if (!caller) {
    // One message for "not signed in", "token invalid" and "not the super user".
    // Telling an unauthorised caller which of the three they are is telling
    // them what to try next.
    return json({ error: 'Only the super user can manage members.' }, 403)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400)
  }

  const action = text(body.action, 32)

  // ------------------------------------------------------------------ create
  if (action === 'create') {
    const email = text(body.email, 254).toLowerCase()
    const fullName = text(body.fullName, 120)
    const role = isRole(body.role) ? body.role : 'user'

    if (!email || !email.includes('@')) {
      return json({ error: 'A valid email address is required.' }, 400)
    }

    const password = temporaryPassword()
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      // No SMTP is configured on this project, so an invitation email would
      // never arrive. The account is created confirmed and the super user
      // passes the first password on directly.
      email_confirm: true,
    })

    if (createError || !created?.user?.id) {
      const detail = createError?.message ?? 'Unknown error'
      const already = /already|exists|registered/i.test(detail)
      return json(
        {
          error: already
            ? 'Someone already has an account with that email address.'
            : `Could not create the account: ${detail}`,
        },
        already ? 409 : 502,
      )
    }

    // The profile row itself is created by the on_auth_user_created trigger;
    // this sets the parts the trigger cannot know.
    const { error: profileError } = await admin
      .from('profiles')
      .update({ role, full_name: fullName, email })
      .eq('id', created.user.id)

    if (profileError) {
      // The account exists but has no role set, which would leave a member who
      // can sign in as a plain user with no way to tell that was unintended.
      // Removing it is the recoverable outcome.
      await admin.auth.admin.deleteUser(created.user.id)
      return json(
        { error: `Could not set the member's access: ${profileError.message}` },
        502,
      )
    }

    return json({ id: created.user.id, email, role, password }, 200)
  }

  // ------------------------------------------------------------------ update
  if (action === 'set-role' || action === 'set-active') {
    const id = text(body.id, 64)
    if (!id) return json({ error: 'A member id is required.' }, 400)

    if (id === caller.id) {
      // The only way to end up with no super user is for the last one to
      // demote or disable themselves, and there is no way back from that
      // without opening the database directly.
      return json(
        { error: 'You cannot change your own access. Ask another super user.' },
        400,
      )
    }

    const patch =
      action === 'set-role'
        ? isRole(body.role)
          ? { role: body.role }
          : null
        : typeof body.active === 'boolean'
          ? { active: body.active }
          : null

    if (!patch) return json({ error: 'That is not a valid change.' }, 400)

    const { error } = await admin.from('profiles').update(patch).eq('id', id)
    if (error) return json({ error: `Could not save: ${error.message}` }, 502)

    return json({ id, ...patch }, 200)
  }

  // ------------------------------------------------------------------ remove
  if (action === 'delete') {
    const id = text(body.id, 64)
    if (!id) return json({ error: 'A member id is required.' }, 400)
    if (id === caller.id) {
      return json({ error: 'You cannot remove your own account.' }, 400)
    }

    // Every table's user_id cascades, so removing an account takes that
    // member's leads, RFPs, activities, proposals and consultants with it —
    // including a bid someone else may be relying on. Switching access off
    // achieves what "they have left" usually means, and keeps the work.
    // The caller has to say plainly that it means the other thing.
    if (body.confirmDataLoss !== true) {
      return json(
        {
          error:
            'Removing an account also deletes everything they own — leads, RFPs, activities and proposals. Switch their access off instead to keep the work.',
        },
        400,
      )
    }

    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) return json({ error: `Could not remove: ${error.message}` }, 502)
    return json({ id, deleted: true }, 200)
  }

  return json({ error: `Unknown action: ${action || '(none)'}` }, 400)
})
