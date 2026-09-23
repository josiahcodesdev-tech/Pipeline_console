#!/usr/bin/env node
/**
 * Write every proposal to a JSON file.
 *
 * The same answer /api/proposals gives over HTTP, produced as a file instead —
 * for when a consumer would rather read something on disk than call an
 * endpoint, or when you want the pipeline in hand without a live query behind
 * it. The shape comes from api/_feed.js, so the two always agree.
 *
 *   npm run proposals:export
 *   npm run proposals:export -- --out build/proposals.json
 *   npm run proposals:export -- --pretty
 *
 * WHERE THIS FILE MUST NOT GO
 * It holds every member's tenders, including the ones row-level security keeps
 * private from everybody but their owner. Three placements leak it, and none
 * of them announce that they have:
 *
 *   public/          Vercel serves that directory to anyone who guesses the
 *                    name. No token, no session, no log worth reading.
 *   src/ or imported Anything the frontend imports is compiled into the bundle
 *                    and shipped to every browser that loads the console.
 *   git              The .gitignore already says it, for .backups/: real
 *                    tender data is never committed.
 *
 * So the default lands at the repo root, which .gitignore covers by name, and
 * --out is there for a path you have thought about rather than one that was
 * convenient. Treat the file the way you would treat the token: it is the same
 * data.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY, because reading past row-level security is
 * the whole point and no other key can. Put it in .env.local beside the
 * others, or pass it in the environment.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { client, readFeed } from '../api/_feed.js'

// --------------------------------------------------------------- settings ---

/** Read from the real environment first, then .env.local, like deploy-fn does. */
function env(name) {
  if (process.env[name]) return process.env[name].trim()
  if (!existsSync('.env.local')) return ''
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`).exec(line)
    if (match) return match[1].trim()
  }
  return ''
}

const args = process.argv.slice(2)

function flag(name) {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? '' : (args[at + 1] ?? '')
}

const OUT = resolve(flag('out') || 'proposals.json')
const PRETTY = args.includes('--pretty')

const CONSOLE_ORIGIN = (env('CONSOLE_ORIGIN') || 'https://pipeline-console-nine.vercel.app')
  .replace(/\/+$/, '')

const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL')
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')

if (!url) {
  console.error('No Supabase URL. Set SUPABASE_URL or VITE_SUPABASE_URL.')
  process.exit(1)
}
if (!serviceKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set and .env.local does not carry it.')
  console.error('')
  console.error('Find it in the Supabase dashboard under Project Settings → API,')
  console.error('then add it to .env.local. It bypasses every row-level security')
  console.error('policy in the project, so it belongs nowhere a browser can reach.')
  process.exit(1)
}

// ------------------------------------------------------------------ read ---

/**
 * The read and the published shape both live in api/_feed.js.
 *
 * They were duplicated here once and that is exactly the arrangement that lets
 * a file export and an endpoint quietly disagree about what a proposal is.
 * One definition, two callers.
 */
const admin = client(url, serviceKey)

// ----------------------------------------------------------------- write ---

console.log(`Reading rfps from ${url} …`)

const payload = { proposals: await readFeed(admin, CONSOLE_ORIGIN) }
const body = PRETTY ? JSON.stringify(payload, null, 2) : JSON.stringify(payload)

mkdirSync(dirname(OUT), { recursive: true })

// Written whole, rather than streamed, so a run that fails partway leaves the
// previous file intact instead of a half-written one that still parses.
writeFileSync(OUT, `${body}\n`)

const kb = (Buffer.byteLength(body) / 1024).toFixed(1)
// Wipe the progress line only if one was drawn, for the same reason.
if (process.stdout.isTTY) process.stdout.write(`\r${' '.repeat(24)}\r`)
console.log(`${payload.proposals.length} proposals → ${OUT} (${kb} KB)`)
console.log('Real tender data. Do not commit it, and do not serve it from public/.')
