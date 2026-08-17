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

/**
 * Characters an email address may contain, as a whitelist.
 *
 * Deliberately not a list of dangerous inputs to reject. Guessing every way a
 * script can be written is a losing game; stating what an address is made of
 * is not, and everything else — angle brackets, quotes, spaces, semicolons —
 * is excluded by never being listed.
 */
const EMAIL = /^[a-z0-9][a-z0-9._+-]*@[a-z0-9-]+(\.[a-z0-9-]+)+$/i

/**
 * Characters a display name may NOT contain.
 *
 * A name is free text in a way an address is not — apostrophes, accents and
 * hyphens are all ordinary in real names — so this is the one place a
 * blacklist is the honest tool. It bars the markup and control characters that
 * make a name into something other than a name.
 *
 * The console renders names through JSX, which escapes them, so a name holding
 * a <script> tag is inert on screen today. That is not the reason to refuse it.
 * A name is also written into generated Word documents and passed to the
 * drafter as context, and neither of those inherits React's escaping — so the
 * guarantee has to live where the name is written, not where it is read.
 */
const NOT_IN_NAME = /[<>{}\\|`]/

/**
 * Invisible characters, which a real name never contains and which exist in
 * pasted input mainly to hide something from whoever reads it back.
 */
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/** A readable complaint, or null when the pair is fit to store. */
function identityProblem(email: string, fullName: string): string | null {
  if (!EMAIL.test(email)) return 'That is not a valid email address.'
  if (!fullName) return null // optional — the list falls back to the address
  if (hasControlCharacters(fullName)) return 'That name contains invisible characters.'
  if (NOT_IN_NAME.test(fullName)) {
    return 'A name cannot contain < > { } \\ | or ` characters.'
  }
  if (!/\p{L}/u.test(fullName)) return 'A name needs at least one letter.'
  return null
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

  // ----------------------------------------------------------- impersonate
  // A one-time magic link switches the browser into the selected member's
  // real Auth session without exposing or changing their password.
  if (action === 'impersonate') {
    const id = text(body.id, 64)
    if (!id || id === caller.id) return json({ error: 'Choose another member account.' }, 400)

    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, email, role, active')
      .eq('id', id)
      .maybeSingle()
    if (targetError) return json({ error: 'Could not verify the selected member.' }, 502)
    if (!target || target.active !== true || !['user', 'admin'].includes(target.role) || !target.email) {
      return json({ error: 'Only an active user or admin account can be opened this way.' }, 400)
    }

    const { data: generated, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: target.email,
    })
    const actionLink = generated?.properties?.action_link
    if (linkError || !actionLink) {
      return json({ error: `Could not create the one-time login: ${linkError?.message ?? 'no link returned'}` }, 502)
    }

    const { error: auditError } = await admin
      .from('impersonation_audit')
      .insert({ actor_id: caller.id, target_id: target.id })
    if (auditError) {
      console.error('Could not audit impersonation', auditError)
      return json({ error: 'The login was refused because it could not be recorded in the audit log.' }, 503)
    }

    return json({ actionLink, email: target.email }, 200)
  }

  // ------------------------------------------------------------------ create
  if (action === 'create') {
    const email = text(body.email, 254).toLowerCase()
    const fullName = text(body.fullName, 120)
    const role = isRole(body.role) ? body.role : 'user'

    // Checked here rather than only in the browser. The console's form is a
    // convenience; this function is the boundary, and anyone holding a super
    // user token can post to it directly.
    const problem = identityProblem(email, fullName)
    if (problem) return json({ error: problem }, 400)

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

    // Give them the current tender pool. Without it the tracker is empty until
    // the next 05:00 run, and a console handed over showing nothing reads as
    // broken rather than as new. A failure here is not worth undoing the
    // account for — tomorrow's sync fills it either way.
    let seeded = 0
    const { data: seedCount, error: seedError } = await admin.rpc('seed_member_rfps', {
      target: created.user.id,
    })
    if (seedError) {
      console.error('Could not seed the tender pool for the new member', seedError)
    } else if (typeof seedCount === 'number') {
      seeded = seedCount
    }

    return json({ id: created.user.id, email, role, password, seeded }, 200)
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

    if (action === 'set-active') {
      const active = body.active as boolean
      const { error: authError } = await admin.auth.admin.updateUserById(id, {
        // The restrictive RLS policy blocks existing access tokens immediately;
        // banning also prevents new sessions and refreshes at the Auth layer.
        ban_duration: active ? 'none' : '876000h',
      })
      if (authError) return json({ error: `Could not change sign-in access: ${authError.message}` }, 502)
    }

    const { error } = await admin.from('profiles').update(patch).eq('id', id)
    if (error) {
      if (action === 'set-active') {
        await admin.auth.admin.updateUserById(id, {
          ban_duration: body.active === true ? '876000h' : 'none',
        })
      }
      return json({ error: `Could not save: ${error.message}` }, 502)
    }

    return json({ id, ...patch }, 200)
  }

  // ------------------------------------------------------------------ remove
  // ---------------------------------------------------------- reset password
  //
  // For the member who is locked out. There is no "forgot password" link on
  // the sign-in page because the project has no SMTP configured, so a reset
  // email would be sent into a void — the super user issues a new one-time
  // password the same way they issued the first.
  //
  // Deliberately available for the super user's *own* account too, unlike
  // set-role and delete: changing your own password is not a way to lock
  // yourself out, it is the way back in.
  if (action === 'reset-password') {
    const id = text(body.id, 64)
    if (!id) return json({ error: 'A member id is required.' }, 400)

    const password = temporaryPassword()
    const { data: updated, error } = await admin.auth.admin.updateUserById(id, {
      password,
    })

    if (error || !updated?.user) {
      return json(
        { error: `Could not reset the password: ${error?.message ?? 'Unknown error'}` },
        502,
      )
    }

    // Returned once and never stored. Everything else about the account is
    // untouched — role, access and every row they own stay exactly as they
    // were; only the way in changes.
    return json({ id, email: updated.user.email ?? '', password }, 200)
  }

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
