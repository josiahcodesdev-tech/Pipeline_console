/**
 * The house palette and typeface, in one place.
 *
 * READ OFF THE TEMPLATE, NOT OFF A PDF. These are the CSS custom properties
 * declared in proposal-templates/ministry_transport_meal_proposal_template.html
 * — `--burgundy`, `--gold`, `--cream`, `--soft`, `--ink` — the same stylesheet
 * that renders the house document. Earlier passes sampled a compressed PDF
 * instead and were wrong in the direction sampling always is: the gold came out
 * brighter and the ink came out black.
 *
 * WHY THIS FILE EXISTS AT ALL. These values were copied into four places — the
 * Word exporter, the on-screen proposal preview, the prompt preview, and a
 * one-off inline style — and correcting one of them corrected one of them. The
 * downloaded document came out in the right burgundy while the preview beside
 * it, which is what anyone actually looks at, stayed in the wrong one. That is
 * the failure mode a duplicated constant always has: it does not break, it
 * disagrees.
 *
 * Two forms because two consumers. `docx` wants bare hex; CSS wants a `#`.
 *
 * If the house style changes, change it in that stylesheet and copy the values
 * here. There is no way to derive one from the other automatically — the
 * template is HTML and one consumer is Word.
 */

/** Bare hex, for `docx`, which rejects a leading `#`. */
export const BRAND_HEX = {
  /** Headings, labels, header and footer. The dominant brand colour. */
  maroon: '5B1017',
  /** Accent: rules under headings, sub-headings, cover flourishes. */
  gold: 'D19A1C',
  /** Alternating table rows and callout boxes. */
  cream: 'FFFAF0',
  /** The label column of a two-column table, a shade down from cream. */
  tan: 'F5EFE2',
  /** Body text. Deliberately not pure black. */
  ink: '2C2926',
  white: 'FFFFFF',
} as const

/** The same colours as CSS, for anything rendered on screen. */
export const BRAND = {
  maroon: `#${BRAND_HEX.maroon}`,
  gold: `#${BRAND_HEX.gold}`,
  cream: `#${BRAND_HEX.cream}`,
  tan: `#${BRAND_HEX.tan}`,
  ink: `#${BRAND_HEX.ink}`,
  white: `#${BRAND_HEX.white}`,
} as const

/**
 * The single typeface, matching the template — every run in it is Georgia.
 *
 * `font-family:Georgia,serif` is what the template's stylesheet declares, on
 * the body and on every heading. Two previous versions guessed otherwise —
 * Cambria headings over Calibri body, then Arial throughout — and both changed
 * the document from a serif to something it is not. Georgia ships with Windows
 * and with Office on macOS, so a proposal opened by a client renders as sent.
 */
export const BRAND_FONT = 'Georgia'

/** With a fallback, for CSS, where the font may genuinely be absent. */
export const BRAND_FONT_STACK = `Georgia, 'Times New Roman', serif`
