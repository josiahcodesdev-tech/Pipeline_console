import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckIcon,
  ExternalLinkIcon,
  PlusIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { proposalText } from '@/documents/template-draft'
import type { Proposal, ProposalDesign, Rfp } from '@/domain/types'

/**
 * Editing a drafted proposal in place.
 *
 * WHAT CHANGED, AND WHY IT MATTERS. This began as a slot editor: the document
 * was rebuilt from the template on every open, and an edit was a change to one
 * of a few hundred short strings. That model could not be broken by editing,
 * because the layout was not in the row to break — but it also could not add a
 * paragraph or remove a section, because the slots had nowhere to record it.
 *
 * The whole document is editable now, so those changes are possible and the
 * old guarantee is gone. What replaces it: the first free edit stores the
 * document itself, and from then on that proposal is served verbatim rather
 * than rebuilt. The trade is stated where it is stored — see `editedPath` on
 * ProposalDesign — and it is a real one. An edited proposal stops inheriting
 * corrections to the house template. It has become its own document.
 *
 * WHY AN IFRAME. The proposal carries its own stylesheet, and the console
 * carries its own. Rendered into this page they would fight — the template
 * styles `h2`, `table` and `.card`, and so does the console. An iframe is a
 * document boundary, so the proposal looks exactly as it will when opened or
 * printed. `srcDoc` keeps it same-origin, which is what lets this read the
 * edits back out.
 *
 * WHY THE TOOLBAR IS NOT IN THE DOCUMENT. Add and delete need buttons, and the
 * obvious place for them is next to the block they act on — inside the iframe.
 * They are rendered here instead, positioned over it. Anything injected into
 * that document has to be found and stripped again before saving, and a single
 * missed node ships console furniture inside a proposal sent to a client. The
 * cost of keeping them outside is arithmetic on two rectangles; the cost of
 * putting them inside is a class of bug that only shows up in the sent copy.
 */

/** Elements a person means when they point at "this bit". */
const BLOCKS = new Set([
  'SECTION',
  'ARTICLE',
  'ASIDE',
  'HEADER',
  'FOOTER',
  'DIV',
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'TABLE',
  'TR',
  'UL',
  'OL',
  'LI',
  'FIGURE',
  'IMG',
  'BLOCKQUOTE',
  'PRE',
])

/** Where the hovered block sits, in the console's coordinates. */
type Spot = { top: number; left: number; width: number; height: number }

/** A removal, kept so it can be put back. */
type Removal = { parent: Node; node: Node; before: Node | null }

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
  onSave: (design: ProposalDesign, html: string, content: string) => Promise<void>
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // The block under the pointer, and where to draw its controls. The element is
  // a ref rather than state because the button handlers read it, and it must
  // not be a render behind the rectangle drawn for it.
  const target = useRef<HTMLElement | null>(null)
  const [spot, setSpot] = useState<Spot | null>(null)

  // Deletions, newest last. Script-driven DOM changes do not reliably enter the
  // browser's own undo stack, so removing a section could otherwise cost it
  // outright — and a proposal is not a document to lose a section from quietly.
  const removals = useRef<Removal[]>([])
  const [undoable, setUndoable] = useState(0)

  /** The block a pointer at this element is really pointing at. */
  const blockOf = useCallback((node: EventTarget | null): HTMLElement | null => {
    let element = node instanceof HTMLElement ? node : null
    while (element) {
      const { tagName } = element
      if (tagName === 'BODY' || tagName === 'HTML') return null
      if (BLOCKS.has(tagName)) return element
      element = element.parentElement
    }
    return null
  }, [])

  /** Redraw the controls against wherever the tracked block now is. */
  const place = useCallback(() => {
    const element = target.current
    const frameRect = frame.current?.getBoundingClientRect()
    if (!element || !frameRect || !element.isConnected) {
      setSpot(null)
      return
    }
    const rect = element.getBoundingClientRect()
    // Scrolled off the top or bottom of the frame: the controls would float
    // over the header or below the window, pointing at nothing.
    if (rect.bottom < 0 || rect.top > frameRect.height) {
      setSpot(null)
      return
    }
    setSpot({
      top: frameRect.top + rect.top,
      left: frameRect.left + rect.left,
      width: rect.width,
      height: rect.height,
    })
  }, [])

  /**
   * Make the document editable and start tracking the pointer.
   *
   * `spellcheck` off deliberately: this is a finished document in a client's
   * house style, full of proper nouns and programme names, and a red underline
   * beneath every one of them reads as errors in the proposal rather than gaps
   * in a dictionary.
   */
  const prepare = useCallback(() => {
    const document_ = frame.current?.contentDocument
    const body = document_?.body
    if (!document_ || !body) return

    body.contentEditable = 'true'
    body.spellcheck = false

    document_.addEventListener('input', () => setDirty(true))
    document_.addEventListener('mousemove', (event) => {
      const found = blockOf(event.target)
      if (found === target.current) return
      target.current = found
      place()
    })
    document_.addEventListener('scroll', place, { passive: true })
    document_.defaultView?.addEventListener('resize', place)

    setReady(true)
  }, [blockOf, place])

  // The frame scrolls independently of the console, but the console resizes
  // around it, and the controls are drawn in the console's coordinates.
  useEffect(() => {
    if (!ready) return
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [ready, place])

  // Warn before losing edits to a closed tab or a navigation.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /** Put a new paragraph after the tracked block and leave the cursor in it. */
  function addAfter() {
    const element = target.current
    const document_ = frame.current?.contentDocument
    if (!element || !document_ || !element.parentNode) return

    const paragraph = document_.createElement('p')
    // A visible placeholder rather than an empty node: an empty paragraph in a
    // printed layout is invisible, and somebody who clicks Add and sees nothing
    // happen clicks it again.
    paragraph.textContent = 'New paragraph — click to write.'
    element.parentNode.insertBefore(paragraph, element.nextSibling)

    setDirty(true)
    // Selected rather than merely focused, so the first keystroke replaces the
    // placeholder instead of typing around it.
    const range = document_.createRange()
    range.selectNodeContents(paragraph)
    const selection = document_.defaultView?.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    paragraph.scrollIntoView({ block: 'nearest' })

    target.current = paragraph
    place()
  }

  /** Take the tracked block out, remembering how to put it back. */
  function removeBlock() {
    const element = target.current
    if (!element?.parentNode) return
    removals.current.push({
      parent: element.parentNode,
      node: element,
      before: element.nextSibling,
    })
    element.remove()
    setUndoable(removals.current.length)
    setDirty(true)
    target.current = null
    setSpot(null)
  }

  function undoRemoval() {
    const last = removals.current.pop()
    if (!last) return
    // `insertBefore` with a null marker appends, which is the right answer when
    // the block was the last of its parent.
    last.parent.insertBefore(last.node, last.before)
    setUndoable(removals.current.length)
    setDirty(true)
    if (last.node instanceof HTMLElement) last.node.scrollIntoView({ block: 'nearest' })
  }

  /**
   * Read every slot back out, by id.
   *
   * Still harvested, though the stored document is now what gets served. The
   * values are what a redraft starts from and what a starred model answer
   * teaches, and a free edit that happened to leave the slots in place should
   * not throw that away. Direct text children only — an element can contain
   * another slot, and `textContent` would swallow the child's words into the
   * parent and save them twice.
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

  /**
   * The document as it should be stored: no trace of having been edited.
   *
   * Taken from a clone, so stripping the editing state cannot disturb what the
   * person is still looking at. `contenteditable` is removed everywhere rather
   * than from the body alone — browsers write it onto elements of their own
   * accord while editing, and one left behind is a proposal that opens
   * editable in the client's browser.
   */
  function finished(document_: Document): string {
    const copy = document_.documentElement.cloneNode(true) as HTMLElement
    for (const element of Array.from(copy.querySelectorAll('[contenteditable]'))) {
      element.removeAttribute('contenteditable')
    }
    copy.removeAttribute('contenteditable')
    for (const element of Array.from(copy.querySelectorAll('[spellcheck]'))) {
      element.removeAttribute('spellcheck')
    }
    return `<!doctype html>${copy.outerHTML}`
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
      const saved = finished(document_)
      await onSave(design, saved, proposalText(saved))
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
    const source = document_ ? finished(document_) : html
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
              ? 'Click anywhere and type · hover a block to add or delete'
              : 'Opening the document…'}
            {dirty && ' · unsaved changes'}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {undoable > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={undoRemoval}
              title="Put back the block you last deleted"
            >
              <Undo2Icon />
              Undo delete
            </Button>
          )}
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

      {/* The controls for the hovered block, drawn over the frame.

          `pointer-events-none` on the outline and `auto` on the buttons: the
          outline must not stand between the pointer and the text it is drawn
          around, or the document underneath stops being clickable. */}
      {spot && (
        <div
          className="pointer-events-none fixed z-[60]"
          style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
        >
          <div className="absolute inset-0 rounded-[3px] outline outline-1 outline-primary/45" />
          <div className="pointer-events-auto absolute -top-3 right-0 flex items-center gap-0.5 rounded-md border border-border bg-card px-1 py-0.5 shadow-brand-sm">
            <button
              type="button"
              onClick={addAfter}
              title="Add a paragraph below this block"
              className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-brand-soft hover:text-primary [&>svg]:size-3.5"
            >
              <PlusIcon />
            </button>
            <button
              type="button"
              onClick={removeBlock}
              title="Delete this block — you can undo it from the bar above"
              className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger [&>svg]:size-3.5"
            >
              <Trash2Icon />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
