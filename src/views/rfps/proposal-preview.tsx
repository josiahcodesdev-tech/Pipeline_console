import { Fragment } from 'react'
import { parseProposal, boldRuns, type Block } from '@/lib/proposal-markdown'

/**
 * The draft as it will look, rendered live while it is written.
 *
 * This used to show raw Markdown — hashes, pipes and asterisks — which told you
 * the drafter was working but nothing about whether the document was any good.
 * A proposal is judged on how it reads, so the preview has to read like one.
 *
 * The colours mirror src/lib/proposal-export.ts, which takes them from the sent
 * proposals. They are hard-coded here rather than pulled from the app's theme
 * on purpose: this pane is a picture of the Word file, not part of the console's
 * own surface, so it must not drift when the console is restyled.
 */
const MAROON = '#6B0F1A'
const GOLD = '#C5973A'
const CREAM = '#F9F3E8'
const TAN = '#F5E6C8'
const INK = '#1A1A1A'

/** Renders `**bold**` runs. Odd segments sat between a matched pair. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {boldRuns(text).map((part, index) =>
        index % 2 === 1 ? (
          <strong key={index}>{part}</strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  )
}

function TableBlock({ rows }: { rows: string[][] }) {
  const width = Math.max(...rows.map((row) => row.length))
  return (
    <table className="my-3 w-full border-collapse text-[12px]">
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {Array.from({ length: width }, (_unused, column) => {
              const header = rowIndex === 0
              // The first body column is the label column — the device that
              // runs through almost every table in the sent proposals.
              const label = !header && column === 0 && width > 1
              return (
                <td
                  key={column}
                  className="border border-black/10 px-2.5 py-1.5 align-top"
                  style={{
                    background: header
                      ? MAROON
                      : label
                        ? TAN
                        : rowIndex % 2 === 1
                          ? '#FFFFFF'
                          : CREAM,
                    color: header ? '#FFFFFF' : label ? MAROON : INK,
                    fontWeight: header || label ? 700 : 400,
                  }}
                >
                  <Rich text={row[column] ?? ''} />
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'blank':
      return null

    case 'heading': {
      const label = block.number ? `${block.number}. ${block.text}` : block.text
      if (block.level === 1) {
        return (
          <h1
            className="mb-3 mt-1 text-[19px] font-bold leading-tight"
            style={{ color: MAROON }}
          >
            {label}
          </h1>
        )
      }
      if (block.level === 2) {
        return (
          <h2
            className="mb-2.5 mt-6 pb-1.5 text-[16px] font-bold leading-tight"
            style={{ color: MAROON, borderBottom: `2px solid ${GOLD}` }}
          >
            {label}
          </h2>
        )
      }
      // Sub-headings are gold in the template.
      return (
        <h3
          className="mb-1.5 mt-4 text-[13.5px] font-bold"
          style={{ color: block.level === 3 ? GOLD : MAROON }}
        >
          {label}
        </h3>
      )
    }

    case 'table':
      return <TableBlock rows={block.rows} />

    case 'callout':
      // A label means the dark panel — the strongest mark on the page.
      return block.label ? (
        <div className="my-3 rounded-sm px-3.5 py-2.5" style={{ background: MAROON }}>
          <p className="mb-1 text-[12.5px] font-bold" style={{ color: GOLD }}>
            {block.label}
          </p>
          <p className="text-[12.5px] leading-relaxed text-white">
            <Rich text={block.text} />
          </p>
        </div>
      ) : (
        <p
          className="my-3 rounded-sm px-3.5 py-2.5 text-[12.5px] italic leading-relaxed"
          style={{ background: CREAM, border: `1px solid ${GOLD}`, color: MAROON }}
        >
          <Rich text={block.text} />
        </p>
      )

    case 'bullet':
      return (
        <li className="ml-4 list-disc text-[12.5px] leading-relaxed" style={{ color: INK }}>
          <Rich text={block.text} />
        </li>
      )

    case 'numbered':
      return (
        <p className="ml-4 text-[12.5px] leading-relaxed" style={{ color: INK }}>
          <span className="font-semibold">{block.marker}. </span>
          <Rich text={block.text} />
        </p>
      )

    case 'paragraph':
      return (
        <p className="mb-2 text-[12.5px] leading-relaxed" style={{ color: INK, textAlign: 'justify' }}>
          <Rich text={block.text} />
        </p>
      )
  }
}

export function ProposalPreview({ markdown }: { markdown: string }) {
  // Re-parsed on every token. The documents are tens of kilobytes and the
  // parser is a single pass of regexes, which is far cheaper than the React
  // render it feeds — memoising here would optimise the wrong half.
  const blocks = parseProposal(markdown)
  return (
    <div style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  )
}
