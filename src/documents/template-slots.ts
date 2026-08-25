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
 * How to read one template.
 *
 * EVERYTHING HERE HAS A DEFAULT, and the defaults are structural rather than
 * cosmetic — tag names and text-bearing elements, which every HTML document
 * has, instead of class names, which are one designer's vocabulary. The first
 * template in this folder called its cards `.card` and its figures `.visual`;
 * the next one will not, and a parser tuned to the first would find a third of
 * the slots in the second and report success.
 *
 * A template supplies a config only where it differs. See
 * proposal-templates/README.md for the sidecar file.
 */
export interface TemplateConfig {
  /** Blocks that become sections. Default covers the common containers. */
  sectionSelector?: string
  /** Where a section's editable prose lives, if it is not the section itself. */
  contentSelector?: string
  /**
   * Alt-text patterns for images whose wording is baked into the picture and
   * therefore cannot follow the template to another client.
   *
   * NO DEFAULT ON PURPOSE. Nothing in the HTML distinguishes a reusable team
   * photograph from a diagram captioned with the previous client's name — both
   * are a JPEG with an alt attribute. Guessing either way is worse than
   * asking: guess "reusable" and a bid goes out naming the wrong ministry,
   * guess "specific" and the firm's own photographs are stripped from every
   * proposal. Unconfigured, every image is reported for a human to judge once,
   * per template, and the answer is written down here.
   */
  assignmentSpecificImages?: string[]
  /** Alt patterns for images that are a rendered page rather than a picture. */
  rebuildAsTextImages?: string[]
  /** Selectors naming the client outside the content area — see fillTemplate. */
  furniture?: {
    title?: boolean
    description?: boolean
    brandName?: string
    brandClient?: string
    footerClient?: string
    navLinks?: string
    remove?: string[]
  }
}

const DEFAULT_SECTION_SELECTOR = 'section, article, .page, .slide'

/**
 * Which classes mean which kind, when a template happens to use these names.
 *
 * Advisory only. A template that uses none of them still yields every slot —
 * the kind falls back to tag and length, which is enough for a drafter to know
 * whether it is writing a label or a paragraph. These simply sharpen it when
 * the vocabulary is recognisable.
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

function kindOf(element: Element, text: string): SlotKind {
  const tag = element.tagName
  if (tag === 'H1' || tag === 'H2') return 'heading'
  if (tag === 'H3' || tag === 'H4') return 'subheading'
  if (tag === 'LI') return 'list-item'
  if (tag === 'TD' || tag === 'TH') return 'table-cell'
  if (tag === 'FIGCAPTION' || tag === 'CAPTION') return 'caption'
  if (tag === 'BLOCKQUOTE') return 'callout'

  for (const { selector, kind } of KIND_BY_CLASS) {
    try {
      if (element.matches(selector)) return kind
    } catch {
      // A selector this DOM implementation will not parse is not worth failing
      // an entire proposal over.
    }
  }

  // Nothing recognised the class, so fall back to what the text itself is.
  // Length is a blunt instrument and a reliable one: a run of four words in a
  // designed layout is a label, whatever the designer called it, and writing a
  // paragraph into it breaks the grid the same way either way.
  if (text.length <= 24) return 'card-title'
  if (text.length <= 90 && !/[.!?]\s/.test(text)) return 'card-body'
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
/**
 * The sections of a template, resolved the same way every time.
 *
 * Exported because the filler must walk the document identically to the
 * extractor — slot ids are positional, so any disagreement about what counts
 * as a section silently writes the right words into the wrong element. The two
 * used to keep their own copies of this and drifted within an hour.
 */
export function sectionsOf(document: Document, config: TemplateConfig = {}): Element[] {
  let sections = Array.from(
    document.querySelectorAll(config.sectionSelector ?? DEFAULT_SECTION_SELECTOR),
  )

  // A template with no sectioning elements at all — a single flowing page,
  // which is a perfectly ordinary way to write one. Treat the body as one
  // section rather than returning nothing and calling it a clean parse.
  if (sections.length === 0 && document.body) sections = [document.body]

  // Nested sections would capture their children's text twice, once as the
  // parent and once as the child, and fill both.
  return sections.filter(
    (section) => !sections.some((other) => other !== section && other.contains(section)),
  )
}

/**
 * The content area within a section, or the section itself.
 *
 * Templates commonly nest one for padding or print margins. Falling back to
 * the section is what lets an unconfigured template work at all.
 */
export function contentOf(section: Element, config: TemplateConfig = {}): Element {
  const selector = config.contentSelector ?? '.page-inner, .content, .inner'
  return section.querySelector(selector) ?? section
}

/** The text an element holds itself, ignoring anything its children own. */
export function ownText(element: Element): string {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === 3 /* TEXT_NODE */)
    .map((node) => node.textContent ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether this element is a slot — used identically by extractor and filler. */
export function isSlot(element: Element): boolean {
  return !SKIP.has(element.tagName) && ownText(element).length >= 2
}

export function extractSlots(html: string, config: TemplateConfig = {}): Slot[] {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const slots: Slot[] = []

  let anonymous = 0
  for (const section of sectionsOf(document, config)) {
    const sectionId = section.getAttribute('id') ?? `section-${anonymous++}`
    const inner = contentOf(section, config)

    let ordinal = 0
    for (const element of Array.from(inner.querySelectorAll('*'))) {
      if (!isSlot(element)) continue
      const own = ownText(element)
      slots.push({
        id: `${sectionId}.${ordinal++}`,
        section: sectionId,
        kind: kindOf(element, own),
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
export interface TemplateImage {
  alt: string
  /** True when the picture carries wording tied to the original assignment. */
  assignmentSpecific: boolean
  /** True when it is a rendered page and should become text instead. */
  rebuildAsText: boolean
  /**
   * True when no rule in the template's config covers this image.
   *
   * The honest state, and the one a new template starts in. Callers must show
   * these rather than defaulting them: an unreviewed image is either safe or a
   * diagram naming the last client, and the HTML cannot tell you which.
   */
  unreviewed: boolean
}

function anyMatches(patterns: string[] | undefined, alt: string): boolean {
  return (patterns ?? []).some((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(alt)
    } catch {
      // A malformed pattern in a config file should not take down drafting.
      return false
    }
  })
}

export function classifyImages(html: string, config: TemplateConfig = {}): TemplateImage[] {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const configured =
    (config.assignmentSpecificImages?.length ?? 0) + (config.rebuildAsTextImages?.length ?? 0) > 0

  return Array.from(document.querySelectorAll('img')).map((image) => {
    const alt = image.getAttribute('alt') ?? ''
    const specific = anyMatches(config.assignmentSpecificImages, alt)
    const rebuild = anyMatches(config.rebuildAsTextImages, alt)
    return {
      alt,
      assignmentSpecific: specific || rebuild,
      rebuildAsText: rebuild,
      // Reviewed means a config exists and this image matched none of its
      // rules — a deliberate "this one is fine". With no config at all,
      // nothing has been decided about anything.
      unreviewed: !configured,
    }
  })
}
