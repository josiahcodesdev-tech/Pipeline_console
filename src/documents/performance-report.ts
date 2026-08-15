/**
 * Renders the drafted Markdown to Word.
 *
 * A small renderer of its own rather than reusing the proposal exporter: that
 * one builds a tender cover page, a contents field and bid footers, all of
 * which would be wrong on a two-page report about a person. This handles the
 * four things the drafter is told to emit — headings, paragraphs, bullets and
 * pipe tables — and nothing else.
 */
export async function downloadPerformanceReportDocx(
  markdown: string,
  periodLabel: string,
): Promise<void> {
  const [
    { BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType },
    { saveAs },
  ] = await Promise.all([import('docx'), import('file-saver')])

  const HAIRLINE = { style: BorderStyle.SINGLE, size: 2, color: 'D8D2C8' }
  const BORDERS = { top: HAIRLINE, bottom: HAIRLINE, left: HAIRLINE, right: HAIRLINE }

  /** `**bold**` becomes a bold run; everything else is plain. */
  const runs = (text: string) =>
    text
      .split(/(\*\*[^*]+\*\*)/g)
      .filter(Boolean)
      .map((part) =>
        part.startsWith('**') && part.endsWith('**')
          ? new TextRun({ text: part.slice(2, -2), bold: true })
          : new TextRun(part),
      )

  const children: object[] = []
  const lines = markdown.split('\n')

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue

    // A pipe table runs until the first line that is not one.
    if (trimmed.startsWith('|')) {
      const block: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        block.push(lines[i].trim())
        i += 1
      }
      i -= 1
      const rows = block
        // The |---|---| separator carries no content.
        .filter((row) => !/^\|[\s:|-]+\|$/.test(row))
        .map((row) =>
          row.slice(1, row.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim()),
        )
      if (rows.length === 0) continue
      const width = Math.max(...rows.map((r) => r.length))
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map(
            (cells, rowIndex) =>
              new TableRow({
                children: Array.from({ length: width }, (_, col) => {
                  const value = cells[col] ?? ''
                  return new TableCell({
                    borders: BORDERS,
                    width: { size: Math.round(100 / width), type: WidthType.PERCENTAGE },
                    children: [
                      new Paragraph({
                        children:
                          rowIndex === 0
                            ? [new TextRun({ text: value.replace(/\*\*/g, ''), bold: true })]
                            : runs(value),
                      }),
                    ],
                  })
                }),
              }),
          ),
        }),
      )
      children.push(new Paragraph({ spacing: { after: 160 }, children: [] }))
      continue
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      children.push(
        new Paragraph({
          heading:
            heading[1].length === 1
              ? HeadingLevel.HEADING_1
              : heading[1].length === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
          spacing: { before: 320, after: 120 },
          children: runs(heading[2]),
        }),
      )
      continue
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/)
    if (bullet) {
      children.push(
        new Paragraph({ bullet: { level: 0 }, children: runs(bullet[1]) }),
      )
      continue
    }

    children.push(new Paragraph({ spacing: { after: 120 }, children: runs(trimmed) }))
  }

  const document = new Document({
    creator: 'Pipeline Console',
    title: `Performance report — ${periodLabel}`,
    sections: [{ children: children as never[] }],
  })

  saveAs(
    await Packer.toBlob(document),
    `Performance report - ${periodLabel.replace(/[\/:*?"<>|]/g, '')}.docx`,
  )
}
