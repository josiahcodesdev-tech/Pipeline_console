#!/usr/bin/env node
/**
 * What the drafter will and will not be able to do with each proposal template.
 *
 * WHY THIS EXISTS. Adding a template is dropping an HTML file in a folder, and
 * everything that then goes wrong goes wrong quietly. A parser that finds a
 * third of the slots reports no error; it reports a shorter list. A furniture
 * selector that matches nothing leaves the previous client's name in the
 * browser tab and the running footer, and the proposal reads perfectly. An
 * image that is really a diagram captioned with somebody else's ministry looks
 * exactly like a team photograph to any amount of code.
 *
 * So this runs the real extractor over every template and prints what it found,
 * what it could not find, and what it refuses to decide. Run it when adding a
 * template, and again after editing one.
 *
 *   npm run templates:check
 *
 * Exits non-zero when something needs a decision, so it can gate a commit.
 *
 * The modules under test are TypeScript written for the browser, so they are
 * bundled on the fly and given a DOM. Testing the shipped code rather than a
 * reimplementation of it is the entire point — a checker with its own copy of
 * the parsing rules would agree with itself and with nothing else.
 */

import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { parseHTML } from 'linkedom'

const DIR = 'proposal-templates'
const EXTENSIONS = new Set(['.html', '.htm'])

const { DOMParser } = parseHTML('<html></html>')
globalThis.DOMParser = DOMParser

const work = mkdtempSync(join(tmpdir(), 'tmpl-check-'))
try {
  await build({
    // One entry re-exporting both, rather than two bundles. Two would each
    // carry their own copy of sectionsOf/contentOf/isSlot, and the filler
    // would then walk the document with a different copy than the extractor —
    // precisely the drift those helpers were shared to prevent, reintroduced
    // by the build step that was meant to be testing for it.
    stdin: {
      contents: `export * from './src/documents/template-slots'
export * from './src/documents/template-fill'`,
      resolveDir: process.cwd(),
      sourcefile: 'template-check-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    outfile: join(work, 'templates.mjs'),
    logLevel: 'error',
  })
} catch (cause) {
  console.error('Could not bundle the template modules:', cause.message)
  process.exit(1)
}

const templateModule = await import(pathToFileURL(join(work, 'templates.mjs')).href)
const slotsModule = templateModule
const fillModule = templateModule

const templates = readdirSync(DIR).filter((file) => EXTENSIONS.has(extname(file).toLowerCase()))
if (templates.length === 0) {
  console.log(`No .html templates in ${DIR}/.`)
  process.exit(0)
}

let needsAttention = 0

for (const file of templates) {
  const name = basename(file, extname(file))
  const configPath = join(DIR, `${name}.config.json`)
  const hasConfig = existsSync(configPath)

  let config = {}
  if (hasConfig) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8'))
    } catch (cause) {
      console.error(`\n${file}\n  ✗ ${basename(configPath)} is not valid JSON — ${cause.message}`)
      needsAttention += 1
      continue
    }
  }

  const html = readFileSync(join(DIR, file), 'utf8')
  const slots = slotsModule.extractSlots(html, config)
  const images = slotsModule.classifyImages(html, config)

  // Filled with a marker per slot, which is what proves the ids round-trip.
  // A slot the extractor reports and the filler cannot find is the failure
  // that put sixteen values on the wrong nodes once already.
  const values = new Map(slots.map((slot) => [slot.id, `«${slot.kind}»`]))
  const result = fillModule.fillTemplate(html, values, { title: 'Check', client: 'Check' }, config)

  const kinds = {}
  for (const slot of slots) kinds[slot.kind] = (kinds[slot.kind] ?? 0) + 1
  const sections = new Set(slots.map((slot) => slot.section))

  console.log(`\n${file}`)
  console.log(`  config      ${hasConfig ? basename(configPath) : 'none — using structural defaults'}`)
  console.log(`  sections    ${sections.size}`)
  console.log(`  slots       ${slots.length}  (${Object.entries(kinds)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${count} ${kind}`)
    .join(', ')})`)

  if (slots.length === 0) {
    console.log('  ✗ no slots found — the section or content selector does not match this template')
    needsAttention += 1
  }
  if (result.unfilled.length > 0) {
    console.log(`  ✗ ${result.unfilled.length} slot(s) could not be written back — ids do not round-trip`)
    needsAttention += 1
  }
  if (result.missingFurniture.length > 0) {
    console.log('  ✗ furniture selectors matching nothing — the old client survives here:')
    for (const entry of result.missingFurniture) console.log(`      ${entry}`)
    needsAttention += 1
  }

  const unreviewed = images.filter((image) => image.unreviewed)
  const removed = images.filter((image) => image.assignmentSpecific)
  if (unreviewed.length > 0) {
    console.log(`  ? ${unreviewed.length} image(s) awaiting a decision — nothing in the HTML says`)
    console.log('    whether these carry the previous client\'s wording. List the ones that do')
    console.log(`    under "assignmentSpecificImages" in ${basename(configPath)}:`)
    for (const image of unreviewed) console.log(`      ${image.alt || '(no alt text)'}`)
    needsAttention += 1
  } else {
    console.log(`  images      ${images.length - removed.length} kept, ${removed.length} removed or rebuilt`)
  }
}

rmSync(work, { recursive: true, force: true })

console.log()
if (needsAttention > 0) {
  console.log(`${needsAttention} thing(s) need a decision. See proposal-templates/README.md.`)
  process.exit(1)
}
console.log('All templates readable.')
