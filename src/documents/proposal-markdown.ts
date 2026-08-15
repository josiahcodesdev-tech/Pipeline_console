/**
 * Parses the drafter's Markdown into blocks, once, for both renderers.
 *
 * There are two: the Word exporter and the live preview panel. They produce
 * completely different output, but they must agree on what the document IS —
 * which lines are a table, what counts as a callout, how sections are
 * numbered. Keeping that judgement here is deliberate. Twice already in this
 * codebase two copies of a vocabulary drifted apart and the symptom was
 * baffling from the outside; a preview that numbers sections differently from
 * the file you send would be the same class of bug, and worse, because you
 * would only find out after submitting.
 */

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; text: string; number: number | null }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'numbered'; marker: string; text: string }
  | { kind: 'table'; rows: string[][] }
  /** A cream box. `label` non-null means the bold dark panel instead. */
  | { kind: 'callout'; label: string | null; text: string }
  | { kind: 'blank' }

/** A `|`-delimited row, minus the outer pipes and trimmed. */
function cells(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/**
 * The `|---|:--:|` line under a header row, which is not data.
 *
 * Only ever applied to the second line of a table. A row of `| - | - |` is
 * legitimate data — "not applicable" in a risk register — and dropping it
 * lower down would quietly lose a row from the buyer's copy.
 */
function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s|:-]+\|[\s|:-]*$/.test(line) && line.includes('-')
}

function isTableRow(line: string): boolean {
  return line.trimStart().startsWith('|')
}

export function parseProposal(markdown: string): Block[] {
  const lines = markdown.split('\n').map((line) => line.trimEnd())
  const blocks: Block[] = []
  let sectionNumber = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      blocks.push({ kind: 'blank' })
      continue
    }

    // Tables are consumed as a block: the rows only mean anything together,
    // and Word needs the whole grid before it can size the columns.
    if (isTableRow(line)) {
      const rows: string[][] = []
      let offset = 0
      while (index < lines.length && isTableRow(lines[index])) {
        if (offset !== 1 || !isTableDivider(lines[index])) {
          rows.push(cells(lines[index]))
        }
        offset += 1
        index += 1
      }
      index -= 1
      if (rows.length > 0) blocks.push({ kind: 'table', rows })
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4
      // Level TWO is a section. In the doctrine `#` is the document title and
      // the bid-readiness appendix, so numbering level one would put "1." in
      // front of the document's own title.
      const number = level === 2 ? (sectionNumber += 1) : null
      blocks.push({ kind: 'heading', level, text: heading[2], number })
      continue
    }

    // `> **Label** text` is the dark panel; a plain `> text` is the cream box.
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      const labelled = /^\*\*(.+?)\*\*\s*(.*)$/.exec(quote[1].trim())
      blocks.push(
        labelled
          ? { kind: 'callout', label: labelled[1], text: labelled[2] }
          : { kind: 'callout', label: null, text: quote[1] },
      )
      continue
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    if (bullet) {
      blocks.push({ kind: 'bullet', text: bullet[1] })
      continue
    }

    const numbered = /^\s*(\d+)\.\s+(.*)$/.exec(line)
    if (numbered) {
      blocks.push({ kind: 'numbered', marker: numbered[1], text: numbered[2] })
      continue
    }

    blocks.push({ kind: 'paragraph', text: trimmed })
  }

  return blocks
}

/** Splits `**bold**` runs. Odd indices sat between a matched pair. */
export function boldRuns(text: string): string[] {
  return text.split('**')
}
