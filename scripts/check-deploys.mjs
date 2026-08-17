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
 * So this compares the two clocks that should agree:
 *
 *   the last commit touching supabase/functions/<name>/
 *   the timestamp Supabase reports for that function's current version
 *
 * Code newer than its deployment is the failure. Uncommitted changes count as
 * undeployed too — they cannot have shipped — and are reported separately,
 * because the fix is a commit rather than a deploy.
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

const FUNCTIONS_DIR = join('supabase', 'functions')

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
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  if (!existsSync('.env.local')) return ''
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = /^\s*SUPABASE_ACCESS_TOKEN\s*=\s*(.*)$/.exec(line)
    if (match) return match[1].trim()
  }
  return ''
}

/** What Supabase currently runs, as {slug: {version, updatedAt}}. */
function deployedFunctions(token) {
  // Run through a shell as one fixed string. npx is a .cmd on Windows and
  // Node has refused to spawn those directly since the CVE-2024-27980 fix;
  // passing an args array alongside shell:true works but is deprecated, since
  // arguments would be concatenated rather than escaped. Nothing here is
  // interpolated — the token travels in the environment, not the command.
  const raw = execSync('npx supabase functions list', {
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
  })

  // The CLI prints warnings (a missing Docker, mostly) above its JSON.
  const line = raw.split(/\r?\n/).find((l) => l.trimStart().startsWith('{'))
  if (!line) throw new Error('Could not find JSON in the CLI output')

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

  console.log('\nConsole (Vercel builds on push)')
  if (ahead && ahead !== '0') {
    console.log(`  ✗ ${ahead} commit(s) on ${branch} not pushed — Vercel is building older code`)
    problems.push('unpushed commits')
  } else {
    console.log(`  ✓ ${branch} matches origin/${branch}`)
  }

  // ----------------------------------------------------------- Edge Functions
  const token = accessToken()
  if (!token) {
    console.log('\nEdge Functions\n  ? SUPABASE_ACCESS_TOKEN not set — not checked')
    unchecked.push('Edge Functions')
    return { problems, unchecked }
  }

  let deployed
  try {
    deployed = deployedFunctions(token)
  } catch (cause) {
    console.log(`\nEdge Functions\n  ? could not reach Supabase — ${cause.message}`)
    unchecked.push('Edge Functions')
    return { problems, unchecked }
  }

  console.log('\nEdge Functions')
  const local = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

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
    console.log(`  ✓ ${name} — v${live.version}, deployed ${stamp(live.updatedAt)}`)
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
