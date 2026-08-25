import { extractSlots, type Slot } from './template-slots'

/**
 * Writing a drafted proposal back into the designed template.
 *
 * The counterpart to template-slots: that finds the words, this replaces them.
 * Between the two, the markup, stylesheet, layout and institutional images are
 * never touched — which is the whole point. A proposal that comes out of here
 * looks like the house document because it *is* the house document, with
 * different words in it.
 *
 * THREE THINGS HAPPEN HERE, AND ONLY THREE.
 *
 * 1. Every slot with a supplied value has its text replaced. A slot with no
 *    value keeps the template's wording, which is wrong for a new bid — so
 *    `fillTemplate` reports those rather than leaving them to be discovered by
 *    a client reading about a transport ministry.
 *
 * 2. Images whose wording is baked into the pixels are removed, with their
 *    figure wrapper, so no empty frame is left behind. See template-slots for
 *    why this is not optional.
 *
 * 3. The two consultant pages, which were full-page image renders, are rebuilt
 *    as text using the template's own card classes. They are the one place
 *    where markup is added rather than filled — unavoidable, because the thing
 *    being replaced was a picture of a page.
 */

/** A drafted value for one slot. */
export interface FilledSlot {
  id: string
  text: string
}

export interface FillResult {
  html: string
  /** Slots left holding the template's original wording. Should be empty. */
  unfilled: Slot[]
  /** Images removed because their wording belonged to the old assignment. */
  removedImages: string[]
}

/**
 * Images that cannot survive a change of client, matched on `alt`.
 *
 * Kept in step with ASSIGNMENT_SPECIFIC in template-slots by intent rather
 * than by import: this list also decides *how* each is replaced, which that
 * one has no opinion about.
 */
const DIAGRAM = /architecture|methodology|eval360|dashboard/i
const CONSULTANT_PROFILE = /consultant profile/i

/**
 * The nearest wrapper that exists only to hold the picture.
 *
 * Removing an `<img>` alone leaves its frame — a bordered, padded, captioned
 * box with nothing in it, which reads as a broken document rather than a
 * shorter one. The template wraps every figure in `.visual`, so that is what
 * goes.
 */
function figureOf(image: Element): Element {
  return image.closest('.visual, .visual-img, figure') ?? image
}

/**
 * Rebuilds a consultant page from text, in the template's own idiom.
 *
 * The original is a rendered page: photograph, credentials, headline figures
 * and a "role in this assignment" panel, all flattened into one JPEG. None of
 * it can be reworded, and all of it is claims — which makes it exactly the
 * content that must not carry over unverified.
 *
 * What replaces it uses `.card` and `.grid-2`, both already in the stylesheet,
 * so the rebuilt section inherits the design rather than approximating it.
 */
function consultantSection(document: Document, values: Map<string, string>, sectionId: string): Element {
  const wrap = document.createElement('div')
  wrap.className = 'grid-2'

  // Four fixed fields, addressed as <section>.role / .credentials / etc. so the
  // drafter fills them like any other slot.
  const fields: ReadonlyArray<{ key: string; label: string }> = [
    { key: 'role', label: 'Role in this assignment' },
    { key: 'credentials', label: 'Qualifications' },
    { key: 'experience', label: 'Relevant experience' },
    { key: 'availability', label: 'Availability and status' },
  ]

  for (const field of fields) {
    const card = document.createElement('div')
    card.className = 'card'
    const heading = document.createElement('h3')
    heading.textContent = field.label
    const body = document.createElement('p')
    // The honest default. A consultant page with no verified record behind it
    // is a bid-stopping gap, and saying so in the document is better than a
    // confident paragraph about someone who was never named.
    body.textContent =
      values.get(`${sectionId}.${field.key}`) ??
      '[INSERT VERIFIED CONSULTANT RECORD — no usable profile was supplied with this bid.]'
    card.append(heading, body)
    wrap.append(card)
  }

  return wrap
}

/**
 * Produces the finished proposal HTML.
 *
 * `values` is keyed by slot id, as produced by `extractSlots`. Anything not in
 * it is reported through `unfilled` rather than silently kept.
 */
export function fillTemplate(
  templateHtml: string,
  values: Map<string, string>,
  document_: { title: string; client: string } = { title: '', client: '' },
): FillResult {
  const document = new DOMParser().parseFromString(templateHtml, 'text/html')
  const removedImages: string[] = []

  // --- text, BEFORE anything moves -----------------------------------------
  // Order matters and cost an hour to learn. Slot ids carry an ordinal — the
  // nth text-bearing element inside a section — so they are only valid against
  // the node order they were extracted from. Removing an image first renumbers
  // everything after it, and sixteen slots silently kept the template's own
  // wording. Text is filled against the untouched tree; images move afterwards.
  const slots = extractSlots(templateHtml)
  const unfilled: Slot[] = []

  const bySection = new Map<string, Element>()
  for (const section of Array.from(document.querySelectorAll('section.page'))) {
    const id = section.getAttribute('id')
    if (id) bySection.set(id, section)
  }

  for (const slot of slots) {
    const value = values.get(slot.id)
    if (value === undefined) {
      unfilled.push(slot)
      continue
    }
    const section = bySection.get(slot.section)
    const inner = section?.querySelector('.page-inner')
    if (!inner) continue

    // Walk the same way extractSlots did, so the nth text-bearing element here
    // is the nth slot there.
    const ordinal = Number(slot.id.split('.').pop())
    let seen = 0
    for (const element of Array.from(inner.querySelectorAll('*'))) {
      const own = Array.from(element.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
      if (own.length < 2) continue
      if (seen === ordinal) {
        // Replace only the direct text children, leaving any child elements —
        // a bold run inside a card, an icon span — exactly where they were.
        for (const node of Array.from(element.childNodes)) {
          if (node.nodeType === 3) node.remove()
        }
        element.append(document.createTextNode(value))
        break
      }
      seen += 1
    }
  }

  // --- images, after every ordinal has been used ---------------------------
  for (const image of Array.from(document.querySelectorAll('img'))) {
    const alt = image.getAttribute('alt') ?? ''
    if (DIAGRAM.test(alt)) {
      figureOf(image).remove()
      removedImages.push(alt)
      continue
    }
    if (CONSULTANT_PROFILE.test(alt)) {
      const section = image.closest('section.page')
      const sectionId = section?.getAttribute('id') ?? ''
      figureOf(image).replaceWith(consultantSection(document, values, sectionId))
      removedImages.push(alt)
    }
  }

  // --- the document's own furniture ----------------------------------------
  // None of this sits inside `.page-inner`, so `extractSlots` never sees it —
  // deliberately, because it is house identity rather than assignment wording.
  // Except that three parts of it name the client, and a proposal whose browser
  // tab, sidebar and running footer all still say "Ministry of Transport" is
  // not a proposal for anybody else.
  const heading = (id: string) =>
    document.querySelector(`section.page#${id} h2`)?.textContent?.trim() ?? ''

  const title = document_.title || heading('executive')
  const fullTitle = document_.client ? `${title} — ${document_.client}` : title
  const titleNode = document.querySelector('title')
  if (titleNode && title) titleNode.textContent = fullTitle

  // The description meta, which nobody looks at and every preview does. Left
  // alone it reads "Responsive HTML proposal template for a Ministry of
  // Transport MEAL training programme" — the last place the old client's name
  // survives, and the one that surfaces when the file is shared as a link.
  const description = document.querySelector('meta[name="description"]')
  if (description && title) description.setAttribute('content', fullTitle)

  // The running footer's second span. The first is the firm's own name and
  // stays exactly as it is.
  for (const footer of Array.from(document.querySelectorAll('.footer'))) {
    const spans = footer.querySelectorAll('span')
    if (spans.length > 1 && title) {
      spans[1].textContent = document_.client ? `${title} • ${document_.client}` : title
    }
  }

  // The sidebar's own masthead: proposal name over client name, beside the
  // logo. The last two places the previous assignment survived.
  const brand = document.querySelector('.brand')
  if (brand && title) {
    const name = brand.querySelector('b')
    if (name) name.textContent = title
    const client = brand.querySelector('small')
    if (client && document_.client) client.textContent = document_.client
  }

  // Sidebar contents. Each entry is `<a><span class="n">01</span>Label</a>`,
  // and the label has to follow the heading it points at or the contents list
  // describes a document that no longer exists.
  for (const link of Array.from(document.querySelectorAll('nav a'))) {
    const target = link.getAttribute('href')?.replace('#', '') ?? ''
    const label = heading(target)
    if (!label) continue
    for (const node of Array.from(link.childNodes)) {
      if (node.nodeType === 3) node.remove()
    }
    link.append(document.createTextNode(label))
  }

  // The editing banner. The template is also a little editor — click-to-edit,
  // a Print button — which is right for someone tweaking it by hand and wrong
  // on a document being handed to a client.
  document.querySelector('.edit-note')?.remove()

  return { html: `<!doctype html>\n${document.documentElement.outerHTML}`, unfilled, removedImages }
}
