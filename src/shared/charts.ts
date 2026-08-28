/**
 * Shared chart constants.
 *
 * Every chart in this console plots ONE measure. The segment and RFP-status
 * charts show a single count across nominal categories, so identity is carried
 * by the category axis and each bar gets the same hue — colouring them
 * individually would double-encode bar length as colour.
 *
 * The mark is the brand brown, which is what the palette leads with. It was
 * briefly the action blue, and before that nearly the brand gold — gold
 * measures 2.24:1 against a white card, below the 3:1 floor for a data mark.
 * Brown (#8b4513) clears it comfortably and agrees with the primary button
 * rather than being a third colour on the page.
 */

/** The action blue. Passes WCAG 3:1 against the white card. */
export const MARK = '#8b4513'

/** Area wash under the trend line — the hue at ~10%, never a saturated block. */
export const MARK_WASH = 'rgba(139, 69, 19, 0.10)'

/** The card surface, used for the 2px ring that keeps end-dots legible. */
export const SURFACE = '#ffffff'

/** Hairline grid, one step off the surface. Solid — never dashed. */
export const GRID = '#e8e1d9'

/** Muted slate; clears 4.5:1 on both the card and the page. */
export const AXIS_TEXT = '#6b5b47'

export const AXIS_TICK = {
  fill: AXIS_TEXT,
  fontSize: 10,
  fontFamily: "'Inter', system-ui, sans-serif",
} as const

/** Bars are capped rather than filling their band, leaving the slot some air. */
export const MAX_BAR_SIZE = 18

/** 4px rounded data-end, square at the baseline (horizontal bars grow right). */
export const BAR_RADIUS: [number, number, number, number] = [0, 4, 4, 0]

/** Hover wash behind a bar — brand brown at low alpha. */
export const BAR_HOVER = 'rgba(139, 69, 19, 0.06)'
