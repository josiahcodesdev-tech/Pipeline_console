#!/usr/bin/env node
/**
 * Compile proposal-templates/ into a module the Edge Function can import.
 *
 * The templates have to reach the drafter, and the drafter runs on Supabase.
 * Edge Functions ship as code, so a template has to become code — hence this
 * step, and hence the deploy that follows it. A file sitting in the folder
 * uncompiled is a file the drafter has never seen, which is the one failure
 * this whole arrangement can produce, so `deploy:fn` runs this automatically
 * rather than trusting anyone to remember.
 *
 *   npm run templates:build
 *
 * Reads .md, .txt and .docx. Word documents are unzipped here rather than
 * asking anyone to convert them by hand: a proposal template arrives as a Word
 * file roughly always, and a step that begins "first, save as Markdown" is a
 * step that gets skipped.
 *
 * The output is generated. Edit the templates, not templates.generated.ts.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { basename, extname, join } from 'node:path'

const SOURCE_DIR = 'proposal-templates'
const OUT_FILE = join('supabase', 'functions', 'concept-note', 'templates.generated.ts')

/**
 * Reads one file out of a zip archive.
 *
 * Via the central directory at the end rather than by scanning for local file
 * headers: when Word streams a document it leaves the compressed size in the
 * local header as zero and writes it afterwards in a data descriptor, so the
 * header alone cannot say where the entry ends. The central directory always
 * knows.
 */
function readZipEntry(buffer, wanted) {
  // End of central directory: signature, then a comment of unknown length, so
  // this is a backwards scan from the end.
  let eocd = -1
  for (let at = buffer.length - 22; at >= 0; at--) {
    if (buffer.readUInt32LE(at) === 0x06054b50) {
      eocd = at
      break
    }
  }
  if (eocd === -1) throw new Error('not a zip file')

  const count = buffer.readUInt16LE(eocd + 10)
  let at = buffer.readUInt32LE(eocd + 16)

  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('corrupt central directory')

    const method = buffer.readUInt16LE(at + 10)
    const compressedSize = buffer.readUInt32LE(at + 20)
    const nameLength = buffer.readUInt16LE(at + 28)
    const extraLength = buffer.readUInt16LE(at + 30)
    const commentLength = buffer.readUInt16LE(at + 32)
    const localAt = buffer.readUInt32LE(at + 42)
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength)

    if (name === wanted) {
      // The local header repeats the name and extra fields, at its own lengths.
      const localNameLength = buffer.readUInt16LE(localAt + 26)
      const localExtraLength = buffer.readUInt16LE(localAt + 28)
      const start = localAt + 30 + localNameLength + localExtraLength
      const raw = buffer.subarray(start, start + compressedSize)
      return method === 0 ? raw : inflateRawSync(raw)
    }

    at += 46 + nameLength + extraLength + commentLength
  }

  throw new Error(`${wanted} is not in the archive`)
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/**
 * The readable text of a .docx, with its paragraph breaks kept.
 *
 * Headings matter here more than anywhere: the whole point of a template is its
 * structure, so a Word heading has to survive as a Markdown one. Word records
 * the style in `w:pStyle` — "Heading1", "Heading2" — which is enough to rebuild
 * the `#` levels the parser downstream reads.
 */
function docxText(buffer) {
  const xml = readZipEntry(buffer, 'word/document.xml').toString('utf8')

  const lines = []
  for (const paragraph of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const runs = paragraph.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? []
    const text = runs
      .map((run) => run.replace(/<[^>]+>/g, ''))
      .join('')
      .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
      .replace(/&([a-z]+);/gi, (whole, name) => XML_ENTITIES[name.toLowerCase()] ?? whole)
      .trim()

    if (!text) continue

    const style = /<w:pStyle w:val="Heading(\d)"/.exec(paragraph)
    lines.push(style ? `${'#'.repeat(Math.min(Number(style[1]) + 1, 6))} ${text}` : text)
  }

  return lines.join('\n\n')
}

function readTemplate(path) {
  const extension = extname(path).toLowerCase()
  if (extension === '.docx') return docxText(readFileSync(path))
  return readFileSync(path, 'utf8')
}

const READABLE = new Set(['.md', '.txt', '.docx'])

function main() {
  if (!existsSync(SOURCE_DIR)) mkdirSync(SOURCE_DIR, { recursive: true })

  const files = readdirSync(SOURCE_DIR)
    .filter((name) => READABLE.has(extname(name).toLowerCase()))
    .filter((name) => name.toLowerCase() !== 'readme.md')
    .sort()

  const templates = []
  for (const file of files) {
    const body = readTemplate(join(SOURCE_DIR, file)).replace(/\r\n/g, '\n').trim()
    if (!body) {
      console.warn(`  ! ${file} — no readable text, skipped`)
      continue
    }
    templates.push({ name: basename(file, extname(file)), body })
    console.log(`  ✓ ${file} — ${body.length.toLocaleString()} chars`)
  }

  const module = `// Generated by scripts/build-templates.mjs — do not edit.
//
// Source: ${SOURCE_DIR}/. Add or change a template there and run
// \`npm run deploy:fn concept-note\`, which regenerates this file before it
// deploys. Editing it here would be overwritten by the next deploy, and would
// put the running structure out of step with the folder anyone reads to see it.

export interface UploadedTemplate {
  /** The file's own name, shown in the console so a draft is traceable to it. */
  name: string
  /** Its readable text: Markdown headings, or a Word file's headings rebuilt. */
  body: string
}

export const UPLOADED_TEMPLATES: UploadedTemplate[] = ${JSON.stringify(templates, null, 2)}
`

  writeFileSync(OUT_FILE, module)
  console.log(
    templates.length
      ? `\n${templates.length} template(s) compiled into ${OUT_FILE}`
      : `\nNo templates in ${SOURCE_DIR}/ — the built-in master structure stays in use.`,
  )
}

main()
