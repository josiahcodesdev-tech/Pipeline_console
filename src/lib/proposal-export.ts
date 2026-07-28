import { formatDateLong, formatKes } from './dates'
import type { Rfp } from './types'

/**
 * Exports a proposal as .docx.
 *
 * `docx` is ~400 kB and only needed when someone actually exports, so it is
 * imported on demand rather than shipped in the main bundle.
 */
export async function downloadProposalDocx(
  rfp: Rfp,
  content: string,
): Promise<void> {
  const [
    { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun },
    { saveAs },
  ] = await Promise.all([import('docx'), import('file-saver')])

  const meta = [
    rfp.org && `Issued by: ${rfp.org}`,
    rfp.deadline && `Submission deadline: ${formatDateLong(rfp.deadline)}`,
    rfp.value !== null && `Estimated value: KES ${formatKes(rfp.value)}`,
    rfp.link && `Notice: ${rfp.link}`,
  ].filter((line): line is string => Boolean(line))

  /**
   * The model writes numbered section headings ("1. Understanding of the
   * Requirement"). Promoting those to real Word headings makes the document
   * navigable rather than one undifferentiated block of prose.
   */
  const isHeading = (line: string) =>
    /^\s*\d+\.\s+\S/.test(line) && line.trim().length < 90

  const body = content
    .split('\n')
    .map((line) => line.trimEnd())
    .map((line) =>
      line.length === 0
        ? new Paragraph({ children: [] })
        : new Paragraph({
            heading: isHeading(line) ? HeadingLevel.HEADING_2 : undefined,
            spacing: { after: 120 },
            children: [new TextRun(line.trim())],
          }),
    )

  const document = new Document({
    creator: 'Pipeline Console',
    title: rfp.title,
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.LEFT,
            children: [new TextRun('Proposal')],
          }),
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: rfp.title, bold: true })],
          }),
          ...meta.map(
            (line) =>
              new Paragraph({
                spacing: { after: 60 },
                children: [new TextRun({ text: line, italics: true, size: 20 })],
              }),
          ),
          new Paragraph({ children: [] }),
          ...body,
        ],
      },
    ],
  })

  const blob = await Packer.toBlob(document)
  // Keep the filename traceable to the tender it answers.
  const slug = rfp.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  saveAs(blob, `proposal-${slug || 'untitled'}.docx`)
}
