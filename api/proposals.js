/**
 * GET /api/proposals — the pipeline as JSON, served from Vercel.
 *
 *   GET https://pipeline-console-nine.vercel.app/api/proposals
 *   Authorization: Bearer <PROPOSALS_FEED_TOKEN>
 *
 * WHY THIS EXISTS WHEN THE EDGE FUNCTION ALREADY DOES THE SAME JOB
 * The Edge Function runs on Supabase. If Supabase is having a bad day, that
 * endpoint is having one too, so it cannot be the thing that keeps answering
 * when the database does not. This one runs on Vercel, beside the console, and
 * shares none of that fate — which is the whole reason to have it.
 *
 * HOW FRESH IT IS
 * Live. Each request reads the table, subject to a short held copy
 * (PROPOSALS_CACHE_TTL_SECONDS, 60s by default) that exists to absorb bursts
 * rather than to trade away freshness. A tender that lands now is in the feed
 * within a minute.
 *
 * WHAT HAPPENS WHEN SUPABASE IS DOWN
 * The last good answer is served again, marked `X-Feed-State: stale` with an
 * `Age` header, instead of a 500. The caller keeps working on data that is
 * merely old, which is almost always better than working on nothing.
 *
 * The honest limit: that copy lives in the instance, so it survives while
 * Vercel keeps one warm — minutes to hours under steady polling — and not
 * across a cold start. A guaranteed fallback needs a durable store (Upstash,
 * R2, a blob); this deliberately does not reach for one until it is wanted.
 *
 * ENVIRONMENT (set these in the Vercel dashboard, Project → Settings → Environment Variables)
 *   PROPOSALS_FEED_TOKEN        the shared secret callers must present
 *   SUPABASE_SERVICE_ROLE_KEY   reads past row-level security; never in a browser
 *   SUPABASE_URL                or VITE_SUPABASE_URL, which is already set
 *   CONSOLE_ORIGIN              optional; defaults to the production console
 *   PROPOSALS_CACHE_TTL_SECONDS optional; 0 reads the table on every request
 */

import { client, readFeed, bearerMatches } from './_feed.js'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const TTL_MS = (() => {
  const raw = Number((process.env.PROPOSALS_CACHE_TTL_SECONDS ?? '').trim())
  return Number.isFinite(raw) && raw >= 0 ? raw * 1000 : 60 * 1000
})()

const CONSOLE_ORIGIN = (process.env.CONSOLE_ORIGIN || 'https://pipeline-console-nine.vercel.app')
  .replace(/\/+$/, '')

/**
 * The held copy, and the read currently filling it.
 *
 * Module state, which on Vercel lives as long as the instance does. That is
 * the honest limit of holding anything here, and the reason the fallback path
 * below is still a plain query.
 */
let stored = null
let filling = null

async function fill(admin) {
  const proposals = await readFeed(admin, CONSOLE_ORIGIN)
  stored = { at: Date.now(), body: JSON.stringify({ proposals }) }
  return stored
}

async function feed(admin, force) {
  if (!force && stored && Date.now() - stored.at < TTL_MS) {
    return { entry: stored, state: 'stored' }
  }

  // One read at a time. Without this, N requests arriving together on a cold
  // instance each start their own full paged scan — the moment the copy is
  // least able to help is the moment it would be hit hardest.
  if (!filling) {
    filling = fill(admin).finally(() => {
      filling = null
    })
  }

  try {
    return { entry: await filling, state: 'fetched' }
  } catch (cause) {
    // A read can fail while a good copy is still in hand. Handing that back is
    // a better answer than a 500, so long as the caller is told it is old.
    if (stored) {
      console.error('proposals feed refresh failed; serving the held copy:', cause)
      return { entry: stored, state: 'stale' }
    }
    throw cause
  }
}

export default async function handler(request, response) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) response.setHeader(key, value)

  if (request.method === 'OPTIONS') return response.status(200).end()
  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Method not allowed' })
  }

  const expected = (process.env.PROPOSALS_FEED_TOKEN ?? '').trim()
  if (!expected) {
    // Refuse rather than fall back to an open endpoint. A feed that starts
    // answering because its secret went missing is the failure worth avoiding.
    return response.status(503).json({ error: 'This feed is not configured.' })
  }

  if (!bearerMatches(request.headers.authorization, expected)) {
    // One message for a missing header, a malformed one and a wrong token.
    // Telling an unauthorised caller which of the three they are is telling
    // them what to try next.
    return response.status(401).json({ error: 'Unauthorized' })
  }

  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !serviceKey) {
    return response.status(500).json({ error: 'This function is missing its Supabase credentials.' })
  }

  try {
    const { entry, state } = await feed(client(url, serviceKey), request.query.refresh === '1')

    // Freshness travels in headers, so the JSON body stays exactly the shape
    // that was agreed. `no-store` because freshness is decided here, by the
    // held copy's age, not by a proxy holding its own guess at one.
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Feed-State', state)
    response.setHeader('Age', String(Math.max(0, Math.round((Date.now() - entry.at) / 1000))))
    return response.status(200).send(entry.body)
  } catch (cause) {
    // The reason is for the function log, not the caller. A database error
    // message can name columns and constraints, and the caller is outside.
    console.error('proposals feed failed:', cause)
    return response.status(500).json({ error: 'Could not read the pipeline.' })
  }
}
