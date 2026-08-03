/**
 * Edge Function: sync-opportunities
 *
 * Pulls the CareerCraft feed into `rfps` on a schedule, so the morning's
 * tenders are waiting in the tracker whether or not anyone opened the app.
 *
 * The in-app sync (src/hooks/use-pipeline.tsx) still runs on load and still
 * powers the manual "Check now" button — this does not replace it. The two are
 * independent on purpose: if this function is never deployed, the console keeps
 * working exactly as it does today, just without the unattended run.
 *
 * NOTE ON DUPLICATION: the feed mapping below mirrors src/lib/opportunities.ts.
 * Both must change together — the feed has already renamed one field
 * (`category` -> `type`) once, and each side reads both spellings for that
 * reason. If you touch one, touch the other.
 *
 * Deploy:
 *   supabase functions deploy sync-opportunities
 *
 * Scheduled by supabase/migrations/0009_scheduled_sync.sql via pg_cron.
 */

import { createClient } from "npm:@supabase/supabase-js@2"

const FEED = Deno.env.get("OPPORTUNITIES_API_URL") ??
  "https://www.mycareercraft.site/api/public/opportunities"

/** The feed's hard ceiling; it exposes no pagination. */
const LIMIT = 500

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

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", hellip: "…",
}

/** The scraper stores titles with entities intact ("Rwanda&apos;s"). */
function decodeEntities(input: string): string {
  if (!input.includes("&")) return input
  return input
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
}

/** Only YYYY-MM-DD survives — a bad date would break deadline sorting. */
function isoDate(value: unknown): string | null {
  const raw = text(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
}

/** Ordered most-specific first, mirroring classifySegment on the client. */
function classifySegment(organization: string, title = ""): string {
  const haystack = `${organization} ${title}`.toLowerCase()
  const has = (...needles: string[]) => needles.some((n) => haystack.includes(n))

  if (has(
    "undp", "unicef", "unesco", "unhcr", "unfpa", "unops", "unep", "unido",
    "united nations", "world bank", "world health", "who ", "wfp", "fao",
    "ilo", "iom", "usaid", "giz", "sida", "danida", "norad", "dfid", "fcdo",
    "european union", "african development bank", "afdb", "gavi",
    "global fund", "development partner", "unwomen", "un women",
  )) return "Development Partner"

  if (has(
    "ministry", "county government", "county of", "government of", "republic of",
    "state department", "national treasury", "public service", "parliament",
    "commission", "regulatory authority", "municipal", "city council",
  )) return "Government"

  if (has("university", "college", "polytechnic", "school of", "institute of technology")) {
    return "University"
  }

  if (has(
    "foundation", "trust", "ngo", "non-governmental", "charity", "relief",
    "red cross", "oxfam", "save the children", "care international",
    "world vision", "plan international", "mercy corps", "caritas",
  )) return "NGO"

  if (has(
    "authority", "corporation", "parastatal", "state corporation",
    "kenya power", "kenya airways", "kenya ports", "national oil",
  )) return "SOE"

  if (has(" ltd", "limited", " plc", " inc", "holdings", "group", "bank", "insurance")) {
    return "Corporate"
  }

  return "Government"
}

interface RfpRow {
  title: string
  org: string
  segment: string
  deadline: string | null
  value: null
  status: string
  link: string
  notes: string
  source: string
  opportunity_type: string
  kenya: boolean
  service_areas: string
  external_id: string
}

async function fetchFeed(): Promise<{ rows: RfpRow[]; skipped: number }> {
  const url = new URL(FEED)
  url.searchParams.set("limit", String(LIMIT))
  const key = Deno.env.get("OPPORTUNITIES_API_KEY")
  if (key) url.searchParams.set("key", key)

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error(`The CareerCraft feed returned ${res.status}.`)

  const payload = await res.json()
  const data = payload?.data
  if (!Array.isArray(data)) throw new Error("Unexpected response from the CareerCraft feed.")

  const rows: RfpRow[] = []
  let skipped = 0

  for (const item of data) {
    if (typeof item !== "object" || item === null) { skipped += 1; continue }

    const externalId = text(item.id)
    const title = decodeEntities(text(item.title))
    if (!externalId || !title) { skipped += 1; continue }

    const org = decodeEntities(text(item.organization))
    const location = decodeEntities(text(item.location))
    // `type` is the current field; `category` is what it used to be called.
    const opportunityType = (text(item.type) || text(item.category)).toLowerCase()

    const serviceAreas = Array.isArray(item.categories)
      ? item.categories
          .map((entry: unknown) => text(entry))
          .filter((entry: string) => entry && entry.toLowerCase() !== "uncategorized")
          .join(", ")
      : ""

    rows.push({
      title,
      org,
      segment: classifySegment(org, title),
      deadline: isoDate(item.deadline),
      value: null,
      status: "Watching",
      link: text(item.url),
      notes: location ? `Location: ${location}` : "",
      // The scraper's own source name, unprefixed — "reliefweb", "worldbank".
      source: text(item.source) || "CareerCraft",
      opportunity_type: opportunityType,
      kenya: item.kenya === true,
      service_areas: serviceAreas,
      external_id: externalId,
    })
  }

  return { rows, skipped }
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

  // This writes on behalf of every user, so it must not be callable with the
  // anon key — which is a valid JWT and is published in the browser bundle.
  // Only a caller already holding the service-role key gets through.
  const auth = request.headers.get("authorization") ?? ""
  if (auth !== `Bearer ${serviceKey}`) {
    return json({ error: "Unauthorized" }, 401)
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  try {
    const { rows, skipped } = await fetchFeed()

    // Rows are per-user: RLS scopes every table by user_id, so a synced tender
    // has to exist once per person who should see it. Syncing for everyone
    // lands the same state their own in-app sync would have produced.
    const { data: userList, error: usersError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    if (usersError) throw new Error(`Could not list users: ${usersError.message}`)

    const users = userList?.users ?? []
    if (users.length === 0) return json({ fetched: rows.length, users: 0, added: 0 }, 200)

    const stamp = new Date().toISOString().slice(0, 10)
    const perUser: Record<string, number> = {}
    let added = 0

    for (const user of users) {
      // `ignoreDuplicates` against rfps_user_external_id_key makes this
      // idempotent: re-running leaves existing rows untouched, so a status
      // moved to Preparing or notes added locally survive every later sync.
      const { data, error } = await admin
        .from("rfps")
        .upsert(
          rows.map((row) => ({
            ...row,
            user_id: user.id,
            sourced: true,
            created_on: stamp,
            status_updated_on: stamp,
          })),
          { onConflict: "user_id,external_id", ignoreDuplicates: true },
        )
        .select("id")

      if (error) {
        console.error(`[sync] insert failed for ${user.id}:`, error.message)
        continue
      }
      perUser[user.id] = data?.length ?? 0
      added += data?.length ?? 0
    }

    return json({ fetched: rows.length, skipped, users: users.length, added, perUser }, 200)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    console.error("[sync] failed:", detail)
    return json({ error: detail }, 502)
  }
})
