#!/usr/bin/env node
/**
 * Is what is running what is written?
 *
 * This project has three deploy surfaces and none of them are the same act:
 * the console goes to Vercel on a push, each Edge Function goes to Supabase
 * only when somebody names it in `supabase functions deploy`, and migrations
 * go with `supabase db push`. Nothing here fails loudly when one of them is
 * skipped — a stale function keeps answering, with the old code, forever.
 *
 * That is not hypothetical. `sync-opportunities` was once deployed at 18:48
 * and edited at 19:22, so the edit sat committed and unshipped while the
 * dashboard cheerfully reported the function as ACTIVE. The gap is invisible
 * precisely because both halves look healthy on their own.
 *
 * So this asks, per function, whether the source on disk is the source that is
 * running. Preferably by fingerprint: `npm run deploy:fn` records a hash of
 * what it sent, and this recomputes it. That answer does not depend on clocks,
 * which matters because clocks cannot tell "deployed, then committed a minute
 * later" from "committed and never deployed" — the first version of this check
 * reported the former as stale, on its own author, within the hour.
 *
 * Where no record exists — a bare `supabase functions deploy`, or a function
 * last shipped before any of this — it falls back to comparing the last commit
 * touching the directory against the deployment timestamp, and marks the result
 * `~` rather than `✓` so a weaker answer is never dressed up as the stronger
 * one.
 *
 * Run it before you say something is live:
 *
 *   npm run check:deploys
 *
 * Exits non-zero when anything is behind, so it can gate a release step.
 * Needs SUPABASE_ACCESS_TOKEN, which it will read from .env.local if it is not
 * already in the environment.
 */

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { hashFunction } from './function-hash.mjs'

const FUNCTIONS_DIR = join('supabase', 'functions')
const STATE_FILE = join(FUNCTIONS_DIR, '.deploy-state.json')

/** Trailing newline stripped; failures become '' rather than throwing. */
function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

/**
 * The access token, from the environment or the local env file.
 *
 * .env.local is parsed rather than sourced: two of its lines have a space
 * after the `=`, which a shell reads as a command and which cost an access
 * token being echoed into a terminal once already.
 */
function accessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) {
    // The environment wins over the file, which is conventional and is also the
    // one way this check fails while the CLI works by hand: a stale token
    // exported in a shell profile silently outranks the good one in .env.local.
    // Named in the error below so the two are told apart in one run rather than
    // two.
    return { token: process.env.SUPABASE_ACCESS_TOKEN, from: 'the SUPABASE_ACCESS_TOKEN environment variable' }
  }
  if (!existsSync('.env.local')) return { token: '', from: 'nowhere — no .env.local and no environment variable' }
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = /^\s*SUPABASE_ACCESS_TOKEN\s*=\s*(.*)$/.exec(line)
    if (match) return { token: match[1].trim(), from: '.env.local' }
  }
  return { token: '', from: 'nowhere — .env.local has no SUPABASE_ACCESS_TOKEN line' }
}

/** What Supabase currently runs, as {slug: {version, updatedAt}}. */
function deployedFunctions(token) {
  // Run through a shell as one fixed string. npx is a .cmd on Windows and
  // Node has refused to spawn those directly since the CVE-2024-27980 fix;
  // passing an args array alongside shell:true works but is deprecated, since
  // arguments would be concatenated rather than escaped. Nothing here is
  // interpolated — the token travels in the environment, not the command.
  let raw
  try {
    raw = execSync('npx supabase functions list', {
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (cause) {
    // execSync's own message is "Command failed: npx supabase functions list",
    // which says only that something went wrong. The CLI already wrote the
    // reason — an expired token, a malformed one, an unreachable project — and
    // it is sitting on the error object.
    //
    // On STDOUT, as JSON, not on stderr: `{"_tag":"Error","error":{"code":...,
    // "message":"Invalid access token format..."}}`, with stderr left empty.
    // Reaching for stderr first with `??` therefore finds "" and stops there,
    // because `??` falls through on null and undefined and an empty string is
    // neither — which is how this swallowed the one useful sentence it had.
    const output = [cause.stdout, cause.stderr].map((s) => String(s ?? '').trim()).find(Boolean) ?? ''
    let said = output
    try {
      const parsed = JSON.parse(output)
      if (parsed?.error?.message) said = parsed.error.message
    } catch {
      // Not JSON — some CLI failures are plain text. Use the first few lines.
      said = output.split(/\r?\n/).filter(Boolean).slice(0, 3).join(' | ')
    }
    throw new Error(said.slice(0, 400) || cause.message)
  }

  // The CLI prints warnings (a missing Docker, mostly) above its JSON.
  const line = raw.split(/\r?\n/).find((l) => l.trimStart().startsWith('{'))
  if (!line) {
    // Quote what it actually said. "Could not find JSON" describes this
    // parser's disappointment, not the fault: the CLI explains itself perfectly
    // well — an expired token, a project it cannot reach, a login it wants —
    // and swallowing that leaves the reader with nothing to act on. Truncated
    // because a stack trace of CLI noise is its own kind of unhelpful.
    const said = raw.trim().split(/\r?\n/).slice(0, 4).join(' | ').slice(0, 400)
    throw new Error(
      said
        ? `the CLI returned no JSON. It said: ${said}`
        : 'the CLI returned nothing at all — check network access to supabase.com',
    )
  }

  const deployed = new Map()
  for (const fn of JSON.parse(line).functions ?? []) {
    deployed.set(fn.slug, { version: fn.version, updatedAt: fn.updated_at })
  }
  return deployed
}

const stamp = (ms) =>
  new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

function main() {
  const problems = []
  /**
   * Checks that could not run.
   *
   * Kept apart from `problems` and never allowed to read as a pass. A guard
   * that answers "all clear" when it did not actually look is worse than no
   * guard, because it is believed.
   */
  const unchecked = []

  // ------------------------------------------------------ the console itself
  // Against the remote ref, refreshed first: a stale origin/main is exactly
  // the reading that says "7 commits unpushed" about commits already pushed.
  git('fetch', '--quiet', 'origin')
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  const ahead = git('rev-list', '--count', `origin/${branch}..HEAD`)

  /**
   * The branch Vercel treats as production.
   *
   * Checked because pushing is not the same as shipping. This project develops
   * on `main` while Vercel's production branch is `master`, so every green
   * build on main was only ever a Preview — the live site sat 18 commits back,
   * on a tree that did not compile. The first version of this check compared
   * main against origin/main, said "✓", and was completely right and totally
   * useless. Override with VERCEL_PRODUCTION_BRANCH when it is neither the
   * remote's default branch nor the one you are on.
   */
  const production =
    process.env.VERCEL_PRODUCTION_BRANCH ||
    git('symbolic-ref', 'refs/remotes/origin/HEAD').replace('refs/remotes/origin/', '') ||
    branch

  console.log('\nConsole (Vercel builds on push)')
  if (ahead && ahead !== '0') {
    console.log(`  ✗ ${ahead} commit(s) on ${branch} not pushed`)
    problems.push('unpushed commits')
  } else {
    console.log(`  ✓ ${branch} matches origin/${branch}`)
  }

  if (production !== branch) {
    const behind = git('rev-list', '--count', `origin/${production}..origin/${branch}`)
    if (behind && behind !== '0') {
      console.log(
        `  ✗ production branch ${production} is ${behind} commit(s) behind ${branch} — ` +
          `builds of ${branch} are Preview only, the live site is older`,
      )
      problems.push(`${production} behind ${branch}`)
    } else {
      console.log(`  ✓ production branch ${production} is level with ${branch}`)
    }
  }

  // ----------------------------------------------------------- Edge Functions
  const { token, from } = accessToken()
  if (!token) {
    console.log(`\nEdge Functions\n  ? SUPABASE_ACCESS_TOKEN comes from ${from} — not checked`)
    unchecked.push('Edge Functions')
    return { problems, unchecked }
  }

  let deployed
  try {
    deployed = deployedFunctions(token)
  } catch (cause) {
    console.log(`\nEdge Functions\n  ? could not reach Supabase — ${cause.message}`)
    console.log(`  the token came from ${from}`)
    unchecked.push('Edge Functions')
    return { problems, unchecked }
  }

  console.log('\nEdge Functions')
  const local = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}

  for (const name of local) {
    const dir = join(FUNCTIONS_DIR, name)
    const committedAt = Number(git('log', '-1', '--format=%ct', '--', dir)) * 1000
    const dirty = git('status', '--porcelain', '--', dir) !== ''
    const live = deployed.get(name)

    if (!live) {
      console.log(`  ✗ ${name} — never deployed`)
      problems.push(name)
      continue
    }

    // The reliable answer, when there is one: does the source on disk hash to
    // what was recorded at deploy time? Independent of when anything was
    // committed, which is the ambiguity that made this check cry wolf.
    const recorded = state[name]?.hash
    if (recorded) {
      if (recorded === hashFunction(dir)) {
        console.log(`  ✓ ${name} — v${live.version}, source matches the recorded deployment`)
      } else {
        console.log(`  ✗ ${name} — source has changed since it was deployed (v${live.version})`)
        problems.push(name)
      }
      continue
    }

    // No record — deployed with the bare CLI, or before this was introduced.
    // Fall back to the clocks, and say that is what happened rather than
    // presenting a weaker check as the same answer.
    if (committedAt > live.updatedAt) {
      console.log(
        `  ✗ ${name} — v${live.version} deployed ${stamp(live.updatedAt)}, ` +
          `code committed ${stamp(committedAt)}`,
      )
      problems.push(name)
      continue
    }
    if (dirty) {
      console.log(`  ! ${name} — uncommitted changes; commit them, then deploy`)
      problems.push(name)
      continue
    }
    console.log(
      `  ~ ${name} — v${live.version}, looks current by timestamp only ` +
        `(no deploy record; use npm run deploy:fn)`,
    )
  }

  // Functions live on the project with no source here. Worth naming rather
  // than ignoring: nobody can review or redeploy what is not in the repo.
  const orphans = [...deployed.keys()].filter((slug) => !local.includes(slug))
  if (orphans.length) {
    console.log(`\n  note: deployed with no source in ${FUNCTIONS_DIR} — ${orphans.join(', ')}`)
  }

  return { problems, unchecked }
}

const { problems, unchecked } = main()

if (problems.length) {
  console.log(`\n${problems.length} thing(s) behind. Deploy with:`)
  console.log('  git push')
  console.log('  npx supabase functions deploy <name>\n')
  process.exit(1)
}
if (unchecked.length) {
  console.log(`\nNothing behind in what was checked, but ${unchecked.join(', ')} could not be.\n`)
  process.exit(1)
}
console.log('\nEverything written is everything running.\n')
