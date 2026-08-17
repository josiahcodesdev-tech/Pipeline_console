/**
 * A fingerprint of one Edge Function's source.
 *
 * Shared by the deploy wrapper, which records it, and the deploy check, which
 * recomputes it. Comparing fingerprints answers the question that actually
 * matters — is the code on disk the code that is running? — without depending
 * on clocks.
 *
 * Timestamps were the first attempt and they cannot answer it. Deploying to
 * try something and committing a minute later leaves the commit newer than the
 * deployment while the two hold identical code, which reads as stale and is
 * not. Content does not have that ambiguity.
 *
 * Paths go into the hash alongside contents, so renaming a file registers as a
 * change even when nothing inside it moved.
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Every file under `dir`, depth-first, as paths relative to it. */
function filesUnder(dir, base = dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...filesUnder(full, base))
    else found.push(relative(base, full))
  }
  return found
}

export function hashFunction(dir) {
  const hash = createHash('sha256')
  // Sorted, and with the separator normalised, so the same tree hashes the
  // same on Windows as it does on the machine that deploys from CI.
  for (const path of filesUnder(dir).sort()) {
    hash.update(path.split(sep).join('/'))
    hash.update('\0')
    hash.update(readFileSync(join(dir, path)))
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}
