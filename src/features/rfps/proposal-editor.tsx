import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckIcon, ExternalLinkIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { proposalText } from '@/documents/template-draft'
import type { Proposal, ProposalDesign, Rfp } from '@/domain/types'

/**
 * Editing a drafted proposal in place.
 *
 * WHAT MAKES THIS POSSIBLE. A saved draft stores its *answers*, not its markup:
 * a few hundred short strings keyed by slot id, rebuilt against the current
 * template whenever anyone opens it. So an edit is a change to some of those
 * strings, and the layout cannot be broken by editing because the layout is not
 * in the row to break.
 *
 * HOW THE WORDS ARE FOUND AGAIN. `fillTemplate` stamps `data-slot` on every
 * element it writes. That is the whole mechanism, and it exists because the
 * obvious alternative does not work: slot ids are positional against the
 * *template*, and the finished document is a different shape — figures
 * captioned for the previous client are removed with their frames, and the
 * consultant pages are rebuilt from cards. Walking the finished document the
 * way the extractor walks the template lands on different elements. The stamp
 * survives all of it.
 *
 * WHY AN IFRAME. The proposal carries its own stylesheet, and the console
 * carries its own. Rendered into this page they would fight — the template
 * styles `h2`, `table` and `.card`, and so does the console. An iframe is a
 * document boundary, so the proposal looks exactly as it will when opened or
 * printed. `srcDoc` keeps it same-origin, which is what lets this read the
 * edits back out.
 *
 * WHAT IS EDITABLE AND WHAT IS NOT. Only the stamped elements. Headings the
 * drafter wrote, yes; the markup around them, the images, the stylesheet, no.
 * That is the same boundary the drafter works within, and it means a person
 * editing cannot produce a document the system could not have produced.
 */
export function ProposalEditor({
  rfp,
  proposal,
  html,
  onClose,
  onSave,
}: {
  rfp: Rfp
  proposal: Proposal
  /** The proposal as rendered — already filled, already stamped. */
  html: string
  onClose: () => void
  onSave: (design: ProposalDesign, content: string) => Promise<void>
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [editable, setEditable] = useState(0)

  /**
   * Turn the stamped elements into editable ones, once the frame has parsed.
   *
   * `plaintext-only` where the browser has it. A proposal slot holds a sentence,
   * not a document: without it a paste from Word brings its own markup into an
   * element the filler will later rewrite as plain text, and the styling
   * survives exactly until the next redraft. Firefox only gained it recently,
   * so `true` is the fallback and the read-back strips markup anyway.
   */
  const prepare = useCallback(() => {
    const document_ = frame.current?.contentDocument
    if (!document_) return

    const slots = Array.from(document_.querySelectorAll<HTMLElement>('[data-slot]'))
    for (const element of slots) {
      element.setAttribute('contenteditable', 'plaintext-only')
      if (element.contentEditable !== 'plaintext-only') {
        element.setAttribute('contenteditable', 'true')
      }
    }

    // A hairline on hover and a real outline on focus. Without something, an
    // editable document is indistinguishable from a printed one and nobody
    // discovers they can type.
    const style = document_.createElement('style')
    style.textContent = `
      [data-slot]{outline:none;transition:background-color .12s}
      [data-slot]:hover{background-color:rgba(218,165,32,.14);cursor:text}
      [data-slot]:focus{background-color:rgba(218,165,32,.22);
        box-shadow:0 0 0 2px rgba(139,69,19,.55);border-radius:2px}
    `
    document_.head?.append(style)

    document_.addEventListener('input', () => setDirty(true))
    setEditable(slots.length)
    setReady(true)
  }, [])

  // Warn before losing edits to a closed tab or a navigation.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /**
   * Read every slot back out, by id.
   *
   * Direct text children only, exactly as the filler wrote them — an element
   * can contain another slot (a `.stat` holds its own `<b>`), and taking
   * `textContent` would swallow the child's words into the parent and save them
   * twice.
   */
  function harvest(document_: Document): Record<string, string> {
    const values: Record<string, string> = {}
    for (const element of Array.from(document_.querySelectorAll('[data-slot]'))) {
      const id = element.getAttribute('data-slot')
      if (!id) continue
      values[id] = Array.from(element.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    }
    return values
  }

  async function save() {
    const document_ = frame.current?.contentDocument
    if (!document_ || !proposal.design) return

    setSaving(true)
    try {
      // Merged over what was there rather than replacing it. A slot the
      // template no longer has — because the template was edited since this
      // draft was written — is not in the document to harvest, and dropping it
      // would quietly discard an answer that comes back the moment the template
      // does.
      const design: ProposalDesign = {
        ...proposal.design,
        values: { ...proposal.design.values, ...harvest(document_) },
      }
      await onSave(design, proposalText(document_.documentElement.outerHTML))
      setDirty(false)
      toast.success('Proposal saved')
      onClose()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  function openInTab() {
    const document_ = frame.current?.contentDocument
    const source = document_?.documentElement.outerHTML ?? html
    const url = URL.createObjectURL(new Blob([source], { type: 'text/html' }))
    const opened = window.open(url, '_blank')
    if (!opened) {
      URL.revokeObjectURL(url)
      toast.error('Allow pop-ups for this site to open the proposal.')
      return
    }
    try {
      opened.opener = null
    } catch {
      // Nothing depends on it.
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <p className="eyebrow text-clay">Editing the proposal</p>
          <p className="truncate text-[13px] font-medium text-foreground">{rfp.title}</p>
          <p className="mt-0.5 text-[11px] text-faint">
            {ready
              ? `${editable} editable pieces of text · click any of them and type`
              : 'Opening the document…'}
            {dirty && ' · unsaved changes'}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={openInTab} disabled={!ready}>
            <ExternalLinkIcon />
            Open in a tab
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Confirmed rather than assumed: this is the only door out that
              // discards work, and an accidental click on it costs an edit
              // nobody can get back.
              if (dirty && !window.confirm('Close without saving your changes?')) return
              onClose()
            }}
          >
            <XIcon />
            Close
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={!ready || saving || !dirty}>
            <CheckIcon />
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </header>

      {/* `srcDoc` rather than a blob URL: it keeps the frame same-origin, which
          is what makes the edits readable back out. A blob URL would render
          identically and then refuse to be read. */}
      <iframe
        ref={frame}
        srcDoc={html}
        onLoad={prepare}
        title={`${rfp.title} — editable proposal`}
        className="min-h-0 flex-1 border-0 bg-muted"
      />
    </div>
  )
}
