#!/usr/bin/env node
/**
 * Deploy an Edge Function and record what was deployed.
 *
 * The recording is the whole point. `supabase functions deploy` leaves nothing
 * behind that says which source went up, so the only evidence afterwards is a
 * timestamp — and a timestamp cannot tell "deployed, then committed a minute
 * later" from "committed and never deployed". Both look like code newer than
 * its deployment. This writes the source fingerprint instead, and
 * `npm run check:deploys` compares against it.
 *
 *   npm run deploy:fn manage-members
 *   npm run deploy:fn concept-note sync-opportunities
 *   npm run deploy:fn --all
 *
 * Deploying with the bare CLI still works and is not wrong — it just leaves
 * the record untouched, and the check falls back to comparing timestamps and
 * says that is what it did.
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashFunction } from './function-hash.mjs'

const FUNCTIONS_DIR = join('supabase', 'functions')
const STATE_FILE = join(FUNCTIONS_DIR, '.deploy-state.json')

function accessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  if (!existsSync('.env.local')) return ''
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = /^\s*SUPABASE_ACCESS_TOKEN\s*=\s*(.*)$/.exec(line)
    if (match) return match[1].trim()
  }
  return ''
}

function localFunctions() {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

const args = process.argv.slice(2)
const names = args.includes('--all') ? localFunctions() : args

if (!names.length) {
  console.error('Name at least one function, or pass --all.')
  console.error(`Available: ${localFunctions().join(', ')}`)
  process.exit(1)
}

for (const name of names) {
  if (!existsSync(join(FUNCTIONS_DIR, name))) {
    console.error(`No such function: ${name}`)
    process.exit(1)
  }
}

const token = accessToken()
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN is not set and .env.local does not carry it.')
  process.exit(1)
}

/**
 * Recompile the proposal templates before concept-note goes up.
 *
 * Done here rather than left as a step to remember, because forgetting it is
 * silent and looks like success: the deploy reports fine, and the drafter keeps
 * using whatever was compiled last time. Running it unconditionally also means
 * the fingerprint below covers the regenerated module, so a template change
 * registers as a source change like any other.
 */
if (names.includes('concept-note')) {
  console.log('Compiling proposal-templates/ …')
  execSync('node scripts/build-templates.mjs', { stdio: 'inherit' })
  console.log('')
}

// Fingerprint before deploying, so an edit made mid-deploy cannot be recorded
// as though it shipped.
const fingerprints = new Map(names.map((name) => [name, hashFunction(join(FUNCTIONS_DIR, name))]))

execSync(`npx supabase functions deploy ${names.join(' ')}`, {
  stdio: 'inherit',
  env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
})

const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}
const deployedAt = new Date().toISOString()
for (const [name, hash] of fingerprints) {
  state[name] = { hash, deployedAt }
}

writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`)
console.log(`\nRecorded in ${STATE_FILE}: ${names.join(', ')}`)
console.log('Commit that file so the record travels with the code.')
