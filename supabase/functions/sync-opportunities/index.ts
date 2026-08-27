/**
 * Edge Function: sync-opportunities
 *
 * Pulls consultancy and training opportunities from every configured source
 * into `rfps`, so the morning's tenders are waiting in the tracker whether or
 * not anyone opened the app.
 *
 * WHY THE FETCHING LIVES HERE AND NOT IN THE BROWSER
 * The console used to call the CareerCraft feed directly from the client, which
 * worked only because that one endpoint sent `Access-Control-Allow-Origin: *`.
 * None of the sources below do, and a 5am run has no browser in it anyway. So
 * this function is now the single fetcher: the scheduled run and the in-app
 * "Check now" button both land here, and the mapping exists in exactly one
 * place rather than being mirrored between client and server.
 *
 * AUTHENTICATION — two callers, two scopes:
 *   service-role key  the cron job. Syncs every user, because rows are
 *                     per-user under RLS and nobody is "logged in" at 05:00.
 *   admin access token the "Check now" button. Syncs every active member so
 *                      users and oversight see the same tender pool at once.
 * The anon key is a valid JWT and ships in the browser bundle, so it must not
 * be enough to trigger either path — see requireCaller below.
 *
 * SOURCES fail independently. A scrape breaking must never cost us the API
 * sources that were working, so each is settled separately and its error is
 * reported rather than thrown.
 *
 * Deploy:
 *   supabase functions deploy sync-opportunities
 * Scheduled by supabase/migrations/0009_scheduled_sync.sql via pg_cron.
 */

import { createClient } from "npm:@supabase/supabase-js@2"

import { type Notice, classifySegment, mentionsKenya } from "./normalize.ts"
import { fetchWorldBank } from "./sources/world-bank.ts"
import { fetchUndp } from "./sources/undp.ts"
import { fetchUngm } from "./sources/ungm.ts"
import { fetchIucn } from "./sources/iucn.ts"
import { fetchAfdb } from "./sources/afdb.ts"
import { fetchReliefWeb } from "./sources/reliefweb.ts"
import { fetchNgoJobsAfrica } from "./sources/ngo-jobs-africa.ts"

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}

interface SourceReport {
  name: string
  status: "ok" | "failed" | "skipped"
  count: number
  detail?: string
}

function keyPart(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * A source-independent identity for the same published procurement notice.
 * External ids remain the strongest key; title + buyer + deadline catches the
 * common case where UNGM and UNDP assign different ids to the same tender.
 */
function noticeKeys(notice: Pick<Notice, "externalId" | "title" | "org" | "deadline">): string[] {
  const keys = [`external:${notice.externalId}`]
  if (notice.deadline) {
    keys.push(`notice:${keyPart(notice.title)}|${keyPart(notice.org)}|${notice.deadline}`)
  }
  return keys
}

/**
 * The registry.
 *
 * `enabled` lets a source sit dormant without being deleted — ReliefWeb needs
 * an appname that has to be requested from them, and reporting it as skipped is
 * more useful than either failing every morning or quietly vanishing.
 */
function registry(): Array<{
  name: string
  run: () => Promise<Notice[]>
  enabled: boolean
  reason?: string
}> {
  const reliefwebAppname = Deno.env.get("RELIEFWEB_APPNAME") ?? ""

  return [
    { name: "World Bank", run: () => fetchWorldBank(), enabled: true },
    { name: "UNDP", run: () => fetchUndp(), enabled: true },
    { name: "UNGM", run: () => fetchUngm(), enabled: true },
    { name: "IUCN", run: () => fetchIucn(), enabled: true },
    { name: "AfDB", run: () => fetchAfdb(), enabled: true },
    { name: "NGO Jobs in Africa", run: () => fetchNgoJobsAfrica(), enabled: true },
    {
      name: "ReliefWeb",
      run: () => fetchReliefWeb(reliefwebAppname),
      enabled: Boolean(reliefwebAppname),
      reason: "RELIEFWEB_APPNAME is not set — request an approved appname from ReliefWeb",
    },
  ]
}

async function collect(): Promise<{ notices: Notice[]; reports: SourceReport[] }> {
  const sources = registry()

  const settled = await Promise.all(
    sources.map(async (source): Promise<{ report: SourceReport; notices: Notice[] }> => {
      if (!source.enabled) {
        return {
          report: { name: source.name, status: "skipped", count: 0, detail: source.reason },
          notices: [],
        }
      }
      try {
        const notices = await source.run()
        return { report: { name: source.name, status: "ok", count: notices.length }, notices }
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause)
        console.error(`[sync] ${source.name} failed:`, detail)
        return {
          report: { name: source.name, status: "failed", count: 0, detail },
          notices: [],
        }
      }
    }),
  )

  // Dedup across sources as well as within them: the same UNDP tender is listed
  // on UNGM too, and whichever connector ran first should win rather than the
  // pair racing to insert against the same unique index.
  const seen = new Set<string>()
  const notices: Notice[] = []
  for (const { notices: batch } of settled) {
    for (const notice of batch) {
      const keys = noticeKeys(notice)
      if (keys.some((key) => seen.has(key))) continue
      for (const key of keys) seen.add(key)
      notices.push(notice)
    }
  }

  return { notices, reports: settled.map((entry) => entry.report) }
}

/** The row shape `rfps` expects — snake_case, unlike the client's camelCase. */
function toRow(notice: Notice, userId: string, stamp: string) {
  return {
    title: notice.title,
    org: notice.org,
    segment: classifySegment(notice.org, notice.title),
    deadline: notice.deadline,
    value: null,
    status: "Watching",
    link: notice.link,
    notes: [
      notice.location ? `Location: ${notice.location}` : "",
      notice.summary ? `Scope: ${notice.summary}` : "",
    ].filter(Boolean).join("\n"),
    source: notice.source,
    opportunity_type: notice.opportunityType,
    kenya: mentionsKenya(notice.title, notice.org, notice.location),
    service_areas: notice.serviceAreas,
    fit_score: notice.fitScore,
    external_id: notice.externalId,
    user_id: userId,
    sourced: true,
    created_on: stamp,
    status_updated_on: stamp,
  }
}

/** An already-tracked row, enough of it to tell whether its tags are stale. */
interface TaggedRow {
  id: string
  serviceAreas: string
  fitScore: number
}

/**
 * Refreshes the derived tags on rows the register already holds.
 *
 * WHY THIS EXISTS. Inserting is idempotent by design — see `ignoreDuplicates`
 * below — and that guarantee is what lets someone move a tender to Preparing
 * and add notes without a later sync trampling them. But it also froze
 * `service_areas` and `fit_score` at whatever the capability map said on the
 * day the row arrived. So every time CAPABILITIES gained a label, it applied
 * only to notices nobody had seen yet, and the rows already sitting in the
 * register stayed invisible to any filter reading that label. The Digital
 * Solutions tracker landed into exactly that: a new label, a register full of
 * rows that could never carry it, and an empty page.
 *
 * Only the two derived columns are written. Both are computed by this function
 * from the notice text and neither is editable in the console, so overwriting
 * them cannot lose anyone's work — which is what separates them from status,
 * notes and value, and why those are still never touched.
 *
 * Reach is deliberately limited to notices in the current run, so this stays
 * bounded by the lookback window rather than sweeping the whole register on
 * every sync. Rows older than that keep the tags they were imported with until
 * their source lists them again; a full backfill is a migration, not this.
 */
async function retag(
  admin: ReturnType<typeof createClient>,
  notices: Notice[],
  tagged: Map<string, TaggedRow> | undefined,
): Promise<number> {
  if (!tagged || tagged.size === 0) return 0

  const stale = notices.flatMap((notice) => {
    const row = tagged.get(notice.externalId)
    if (!row) return []
    // Unchanged is the overwhelmingly common case — a sync that changed no
    // capability should issue no writes at all.
    if (row.serviceAreas === notice.serviceAreas && row.fitScore === notice.fitScore) {
      return []
    }
    return [{ row, notice }]
  })

  let updated = 0
  for (const { row, notice } of stale) {
    const { error } = await admin
      .from("rfps")
      .update({ service_areas: notice.serviceAreas, fit_score: notice.fitScore })
      .eq("id", row.id)
    // A failed retag is cosmetic — the row is still in the register with its
    // old tags — so it is logged and stepped over rather than failing the sync.
    if (error) console.error(`[sync] retag failed for ${row.id}:`, error.message)
    else updated += 1
  }
  return updated
}

/**
 * Resolves who is calling, and how much they may sync.
 *
 * Returning null means "not allowed" — deliberately indistinguishable from a
 * bad token, so this cannot be used to probe for valid keys.
 */
/**
 * How long an expired tender stays after its deadline.
 *
 * Not zero. A bid team reads the week's closures to check nothing was missed,
 * and deleting a tender the morning after it shut takes that away. Seven days
 * is the window in which somebody might still look; past it, an untouched
 * expired notice is landfill nobody will ever open.
 */
const EXPIRY_GRACE_DAYS = 7

/**
 * Removes expired tenders nobody touched.
 *
 * WHY THIS BELONGS TO THE SYNC. The sync is what put them there. It adds every
 * notice matching the capability map to every member's tracker, most of which
 * are never opened, and without a counterpart the tracker only grows -- 2,256
 * rows by the time this was written, of which 691 had already closed. A source
 * of rows with no sink is a source of noise.
 *
 * WHERE THE RULE ACTUALLY LIVES. In `prune_expired_rfps`, migration 0042, and
 * nowhere else. It is six `not exists` subqueries that PostgREST cannot express
 * as a filter, and a paraphrase of them here would drift from the real one
 * inside a release — the same reason 0027 deleted by explicit id rather than by
 * restating its rule in SQL. Doing it in one statement server-side also closes
 * the gap a fetch-then-delete would leave, where a member could claim a tender
 * in the moment between the two.
 *
 * WHY IT IS SAFE TO DELETE RATHER THAN HIDE. The connectors filter to open
 * notices, so a pruned tender is not re-added tomorrow by the very run that
 * deleted it.
 *
 * Failures are reported, never thrown. A tidy-up that takes the whole morning
 * sync down with it has its priorities backwards.
 */
async function pruneExpired(
  admin: ReturnType<typeof createClient>,
): Promise<{ pruned: number; problem: string | null }> {
  const { data, error } = await admin.rpc("prune_expired_rfps", {
    grace_days: EXPIRY_GRACE_DAYS,
  })
  if (error) return { pruned: 0, problem: error.message }
  return { pruned: typeof data === "number" ? data : 0, problem: null }
}

async function requireCaller(
  request: Request,
  admin: ReturnType<typeof createClient>,
  serviceKey: string,
): Promise<{ userId?: string } | null> {
  const header = request.headers.get("authorization") ?? ""
  const token = header.replace(/^Bearer\s+/i, "").trim()
  if (!token) return null

  // The cron job. Compared whole rather than decoded — this is the same trust
  // boundary as the key itself.
  if (token === serviceKey) return {}

  // A signed-in user. getUser resolves the token against the auth server, which
  // is what keeps the anon key out: it is a valid JWT but carries no user, so
  // this returns nothing and the request is refused.
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user?.id) return null

  // Pulling the sources by hand is an admin action. The console already hides
  // the button from everyone else, but a hidden button is not a check — this
  // is. The role is read from `profiles` rather than from the token, because a
  // JWT carries whatever claims it was minted with and the profiles table is
  // writable only by the super user.
  const { data: profile } = await admin
    .from("profiles")
    .select("role, active")
    .eq("id", data.user.id)
    .maybeSingle()

  const role = (profile as { role?: string; active?: boolean } | null)
  if (!role || role.active !== true) return null
  if (role.role !== "super_user" && role.role !== "admin") return null

  return { userId: data.user.id }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS })
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const url = Deno.env.get("SUPABASE_URL")
  if (!serviceKey || !url) {
    return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not available." }, 500)
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const caller = await requireCaller(request, admin, serviceKey)
  if (!caller) return json({ error: "Unauthorized" }, 401)

  try {
    const { notices, reports } = await collect()

    // Every source failing is an outage worth surfacing as an error, not a
    // cheerful "0 added" that looks like a quiet morning.
    if (notices.length === 0 && reports.every((r) => r.status !== "ok")) {
      return json(
        { error: "Every source failed or is unconfigured.", sources: reports },
        502,
      )
    }

    // Profiles, not auth.users: switched-off accounts keep their history but
    // must not receive fresh copies of every tender on each sync.
    const { data: activeProfiles, error: usersError } = await admin
      .from("profiles")
      .select("id")
      .eq("active", true)
    if (usersError) throw new Error(`Could not list active members: ${usersError.message}`)
    const userIds = (activeProfiles ?? []).map((profile) => profile.id as string)

    if (userIds.length === 0) {
      return json({ fetched: notices.length, users: 0, added: 0, alreadyHave: 0, retagged: 0, skipped: [], sources: reports }, 200)
    }

    const stamp = new Date().toISOString().slice(0, 10)
    const perUser: Record<string, number> = {}
    const failedUsers: string[] = []
    const newlyAddedTenders = new Set<string>()
    let retagged = 0

    // Read the current register once for the whole team. This prevents a
    // notice being reconsidered as new merely because another portal gave it
    // a different external id. Paging matters: a firm-wide register can pass
    // PostgREST's default 1,000-row response limit.
    const existingByUser = new Map<string, Set<string>>()
    // The same rows again, addressable by external id, so a notice we are about
    // to skip as already-tracked can still have its derived tags refreshed.
    // See retagging below for why that is worth carrying.
    const taggedByUser = new Map<string, Map<string, TaggedRow>>()
    const pageSize = 1000
    for (let from = 0; ; from += pageSize) {
      const { data: existing, error: existingError } = await admin
        .from("rfps")
        .select("id, user_id, external_id, title, org, deadline, service_areas, fit_score")
        .range(from, from + pageSize - 1)
      if (existingError) throw new Error(`Could not check existing RFPs: ${existingError.message}`)
      for (const row of existing ?? []) {
        const userId = row.user_id as string
        const keys = existingByUser.get(userId) ?? new Set<string>()
        if (typeof row.external_id === "string" && row.external_id) {
          keys.add(`external:${row.external_id}`)
          const tagged = taggedByUser.get(userId) ?? new Map<string, TaggedRow>()
          tagged.set(row.external_id, {
            id: row.id as string,
            serviceAreas: typeof row.service_areas === "string" ? row.service_areas : "",
            fitScore: typeof row.fit_score === "number" ? row.fit_score : 0,
          })
          taggedByUser.set(userId, tagged)
        }
        if (typeof row.deadline === "string" && row.deadline) {
          keys.add(`notice:${keyPart(row.title)}|${keyPart(row.org)}|${row.deadline}`)
        }
        existingByUser.set(userId, keys)
      }
      if ((existing ?? []).length < pageSize) break
    }

    for (const userId of userIds) {
      const existingKeys = existingByUser.get(userId) ?? new Set<string>()
      const newNotices = notices.filter((notice) =>
        noticeKeys(notice).every((key) => !existingKeys.has(key))
      )

      retagged += await retag(admin, notices, taggedByUser.get(userId))

      if (newNotices.length === 0) {
        perUser[userId] = 0
        continue
      }
      // `ignoreDuplicates` against rfps_user_external_id_key makes this
      // idempotent: re-running leaves existing rows untouched, so a status
      // moved to Preparing or notes added locally survive every later sync.
      const { data, error } = await admin
        .from("rfps")
        .upsert(
          newNotices.map((notice) => toRow(notice, userId, stamp)),
          { onConflict: "user_id,external_id", ignoreDuplicates: true },
        )
        .select("external_id")

      if (error) {
        console.error(`[sync] insert failed for ${userId}:`, error.message)
        failedUsers.push(userId)
        continue
      }
      perUser[userId] = data?.length ?? 0
      for (const row of data ?? []) {
        if (typeof row.external_id === "string") newlyAddedTenders.add(row.external_id)
      }
    }

    // After the insert, not before: a notice that closed this morning and is
    // still on a feed should be added and then left alone, rather than being
    // pruned by the same run that fetched it.
    const { pruned, problem: pruneProblem } = await pruneExpired(admin)

    const fetched = notices.length
    // A button click reports newly visible tenders, not physical copies written
    // across the team. The scheduled service call has no user and reports the
    // total write count for operational logs.
    const addedForCaller = caller.userId
      ? (perUser[caller.userId] ?? 0)
      : newlyAddedTenders.size

    return json(
      {
        fetched,
        added: addedForCaller,
        alreadyHave: Math.max(0, fetched - addedForCaller),
        // Rows already held whose service areas or fit changed under a revised
        // capability map. Reported so a run that added nothing but re-tagged
        // dozens of rows does not read as a no-op.
        retagged,
        // Expired tenders nobody had touched, removed. Reported so a run that
        // added nothing still shows it did something, and so a prune that
        // starts deleting more than it should is visible before somebody
        // notices their tracker is empty.
        pruned,
        // Failures only. A source that is deliberately unconfigured — ReliefWeb
        // without an appname — is a setting, not a fault, and warning about it
        // on every single run would train people to ignore the warning. It is
        // still in `sources` below for anyone actually looking.
        skipped: reports
          .filter((report) => report.status === "failed")
          .map((report) => `${report.name}: ${report.detail ?? "failed"}`)
          .concat(failedUsers.length ? [`Could not update ${failedUsers.length} member account(s).`] : [])
          .concat(pruneProblem ? [`Could not prune expired tenders: ${pruneProblem}`] : []),
        users: userIds.length,
        sources: reports,
        perUser,
      },
      200,
    )
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    console.error("[sync] failed:", detail)
    return json({ error: detail }, 502)
  }
})
