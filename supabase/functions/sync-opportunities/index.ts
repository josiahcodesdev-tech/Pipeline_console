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
 *   user access token  the "Check now" button. Syncs only the caller.
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
      if (seen.has(notice.externalId)) continue
      seen.add(notice.externalId)
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
    notes: notice.location ? `Location: ${notice.location}` : "",
    source: notice.source,
    opportunity_type: notice.opportunityType,
    kenya: mentionsKenya(notice.title, notice.org, notice.location),
    service_areas: notice.serviceAreas,
    external_id: notice.externalId,
    user_id: userId,
    sourced: true,
    created_on: stamp,
    status_updated_on: stamp,
  }
}

/**
 * Resolves who is calling, and how much they may sync.
 *
 * Returning null means "not allowed" — deliberately indistinguishable from a
 * bad token, so this cannot be used to probe for valid keys.
 */
async function requireCaller(
  request: Request,
  admin: ReturnType<typeof createClient>,
  serviceKey: string,
): Promise<{ scope: "all" } | { scope: "self"; userId: string } | null> {
  const header = request.headers.get("authorization") ?? ""
  const token = header.replace(/^Bearer\s+/i, "").trim()
  if (!token) return null

  // The cron job. Compared whole rather than decoded — this is the same trust
  // boundary as the key itself.
  if (token === serviceKey) return { scope: "all" }

  // A signed-in user. getUser resolves the token against the auth server, which
  // is what keeps the anon key out: it is a valid JWT but carries no user, so
  // this returns nothing and the request is refused.
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user?.id) return null
  return { scope: "self", userId: data.user.id }
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

    let userIds: string[]
    if (caller.scope === "self") {
      userIds = [caller.userId]
    } else {
      const { data: userList, error: usersError } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      })
      if (usersError) throw new Error(`Could not list users: ${usersError.message}`)
      userIds = (userList?.users ?? []).map((user) => user.id)
    }

    if (userIds.length === 0) {
      return json({ fetched: notices.length, users: 0, added: 0, alreadyHave: 0, skipped: [], sources: reports }, 200)
    }

    const stamp = new Date().toISOString().slice(0, 10)
    const perUser: Record<string, number> = {}
    let added = 0

    for (const userId of userIds) {
      // `ignoreDuplicates` against rfps_user_external_id_key makes this
      // idempotent: re-running leaves existing rows untouched, so a status
      // moved to Preparing or notes added locally survive every later sync.
      const { data, error } = await admin
        .from("rfps")
        .upsert(
          notices.map((notice) => toRow(notice, userId, stamp)),
          { onConflict: "user_id,external_id", ignoreDuplicates: true },
        )
        .select("id")

      if (error) {
        console.error(`[sync] insert failed for ${userId}:`, error.message)
        continue
      }
      perUser[userId] = data?.length ?? 0
      added += data?.length ?? 0
    }

    // Reported per calling user rather than in total, so the number the button
    // shows matches what that person actually gained.
    const fetched = notices.length
    const addedForCaller = caller.scope === "self" ? (perUser[caller.userId] ?? 0) : added

    return json(
      {
        fetched,
        added: addedForCaller,
        alreadyHave: Math.max(0, fetched - addedForCaller),
        skipped: reports
          .filter((report) => report.status !== "ok")
          .map((report) => `${report.name}: ${report.detail ?? report.status}`),
        users: userIds.length,
        sources: reports,
        perUser: caller.scope === "all" ? perUser : undefined,
      },
      200,
    )
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    console.error("[sync] failed:", detail)
    return json({ error: detail }, 502)
  }
})
