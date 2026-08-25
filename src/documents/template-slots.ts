/**
 * Turning a designed HTML proposal into a list of words to rewrite.
 *
 * THE PROBLEM THIS SOLVES. The firm's template is a designed document — a
 * cover, section pages, stat grids, cards, day tables, callouts — and every
 * visible string in it belongs to the assignment it was written for. Reusing it
 * means keeping the markup and replacing the words, all of them, including the
 * two-word ones inside a card. "10 days" and "Transport focus" are as
 * assignment-specific as any paragraph, and a filler that only swaps <p> text
 * ships a Water Sector bid with a card reading "Transport focus".
 *
 * So the unit here is a *slot*: one editable text node, identified well enough
 * to write back into, and typed well enough that a drafter knows what belongs
 * there. A stat label is three words; a lead paragraph is sixty. The type is
 * what tells them apart.
 *
 * WHAT THIS DELIBERATELY DOES NOT TOUCH. Markup, classes, inline styles,
 * images. The design is the part being preserved; this only finds the words
 * sitting inside it.
 *
 * PARSED WITH DOMParser RATHER THAN REGEX. The template is 3.6MB of HTML with
 * base64 images in it, and the nesting is real: cards inside grids inside
 * sections. Regex over that is how you get a filler that works on seventeen
 * sections and silently corrupts the eighteenth.
 */

/** What kind of text a slot holds, which is what decides how much to write. */
export type SlotKind =
  | 'kicker' // "01 / Executive Summary" — the small label above a heading
  | 'heading' // the section's h2
  | 'subheading' // an h3 inside a section
  | 'lead' // the opening paragraph, set larger than body text
  | 'body' // an ordinary paragraph
  | 'card-title' // the bold line that opens a card
  | 'card-body' // the rest of a card
  | 'stat-value' // "10 days" — the large figure in a stat block
  | 'stat-caption' // "Structured practical training"
  | 'list-item' // a bullet
  | 'table-cell' // a cell in the schedule or a matrix
  | 'caption' // the line under an image
  | 'callout' // a highlighted box, usually one sentence

export interface Slot {
  /** Stable address to write back to: section id + ordinal within it. */
  id: string
  /** The `id` of the enclosing `<section class="page">`. */
  section: string
  kind: SlotKind
  /** What the template currently says here — the voice reference, never copied. */
  original: string
  /**
   * Roughly how long the replacement should be, in characters, taken from what
   * the template does rather than from a rule. A card that holds twelve words
   * in the design holds twelve words after filling, or the layout breaks — the
   * grid does not reflow to accommodate a paragraph where a label belongs.
   */
  budget: number
}

/**
 * Which classes mean which kind.
 *
 * Ordered: the first match wins, so the specific sits above the general. A
 * `.stat b` is a stat-value before it is a card-title.
 */
const KIND_BY_CLASS: ReadonlyArray<{ selector: string; kind: SlotKind }> = [
  { selector: '.section-kicker', kind: 'kicker' },
  { selector: '.stat b', kind: 'stat-value' },
  { selector: '.stat', kind: 'stat-caption' },
  { selector: '.pill b', kind: 'card-title' },
  { selector: '.pill', kind: 'card-body' },
  { selector: '.callout', kind: 'callout' },
  { selector: '.quote', kind: 'callout' },
  { selector: '.caption', kind: 'caption' },
  { selector: '.card h3', kind: 'card-title' },
  { selector: '.card', kind: 'card-body' },
  { selector: '.day', kind: 'table-cell' },
  { selector: '.step', kind: 'card-body' },
  { selector: '.lead', kind: 'lead' },
]

/** Elements whose text is structural furniture, not assignment wording. */
const SKIP = new Set(['STYLE', 'SCRIPT', 'IMG', 'BR', 'HR'])

function kindOf(element: Element): SlotKind {
  const tag = element.tagName
  if (tag === 'H2') return 'heading'
  if (tag === 'H3') return 'subheading'
  if (tag === 'LI') return 'list-item'
  if (tag === 'TD' || tag === 'TH') return 'table-cell'
  for (const { selector, kind } of KIND_BY_CLASS) {
    if (element.matches(selector)) return kind
  }
  return 'body'
}

/**
 * A generous ceiling on the replacement, derived from the original.
 *
 * Not the exact length: a rewrite that had to match character for character
 * would produce padded or truncated prose, which reads worse than a slightly
 * different line looks. A quarter of headroom absorbs normal variation while
 * still refusing a paragraph where a label belongs.
 */
function budgetFor(original: string): number {
  return Math.max(24, Math.ceil(original.trim().length * 1.25))
}

/**
 * Every editable text slot in the template, in document order.
 *
 * Only elements inside a `.page-inner` are considered — the cover furniture,
 * running headers and the accreditation strip are house identity rather than
 * assignment wording, and rewriting them would change who the document says
 * it is from.
 *
 * An element contributes a slot only when it holds text directly. A grid that
 * contains cards is not a slot; the cards are. Without that rule the grid's
 * combined text would be captured as one enormous slot *and* again as its
 * parts, and writing both back would duplicate the content.
 */
export function extractSlots(html: string): Slot[] {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const slots: Slot[] = []

  for (const section of Array.from(document.querySelectorAll('section.page'))) {
    const sectionId = section.getAttribute('id') ?? `section-${slots.length}`
    const inner = section.querySelector('.page-inner')
    if (!inner) continue

    let ordinal = 0
    for (const element of Array.from(inner.querySelectorAll('*'))) {
      if (SKIP.has(element.tagName)) continue

      // Text held directly by this element, ignoring anything a child owns.
      // This is what keeps a card and its wrapper from both claiming the same
      // words.
      const own = Array.from(element.childNodes)
        .filter((node) => node.nodeType === 3 /* TEXT_NODE */)
        .map((node) => node.textContent ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim()

      if (own.length < 2) continue

      slots.push({
        id: `${sectionId}.${ordinal++}`,
        section: sectionId,
        kind: kindOf(element),
        original: own,
        budget: budgetFor(own),
      })
    }
  }

  return slots
}

/**
 * Images the template carries, split by whether they can survive a new bid.
 *
 * THIS IS THE LIMIT OF "KEEP THE DESIGN, CHANGE THE WORDING". Six of the
 * sixteen images in the house template have their words baked into the pixels:
 * a diagram captioned "Eval360 for a Ministry of Transport", a dashboard suite
 * labelled for transport, and two full-page consultant profiles that state
 * credentials and describe a role on *that* assignment. No text rule reaches
 * inside a JPEG, so filling the template while keeping them would ship a
 * proposal whose diagrams name the wrong client — the same failure the
 * evidence rules exist to prevent, arriving by a route they cannot see.
 *
 * Classified by `alt`, which the template sets on every image, rather than by
 * position: positions move when a section is added.
 */
const ASSIGNMENT_SPECIFIC = /architecture|methodology|eval360|dashboard|consultant profile/i

export interface TemplateImage {
  alt: string
  /** True when the picture carries wording tied to the original assignment. */
  assignmentSpecific: boolean
}

export function classifyImages(html: string): TemplateImage[] {
  const document = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(document.querySelectorAll('img')).map((image) => {
    const alt = image.getAttribute('alt') ?? ''
    return { alt, assignmentSpecific: ASSIGNMENT_SPECIFIC.test(alt) }
  })
}
