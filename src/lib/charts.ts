/**
 * Shared chart constants.
 *
 * Every chart in this console plots ONE measure. The segment and RFP-status
 * charts show a single count across nominal categories, so identity is carried
 * by the category axis and each bar gets the same hue — colouring them
 * individually would double-encode bar length as colour. A five-colour status
 * ramp was tried and rejected: `Preparing` and `Submitted` sit at OKLab ΔE 3.8,
 * which is indistinguishable even with full colour vision.
 *
 * Consequence: there is no categorical palette here, so no legend is needed
 * (a single series is named by its title) and no CVD separation to defend.
 */

/** The brand gold. Passes WCAG 3:1 against the card surface (#1b1e17). */
export const MARK = '#c99a3e'

/** Area wash under the trend line — the hue at ~10%, never a saturated block. */
export const MARK_WASH = 'rgba(201, 154, 62, 0.10)'

/** The card surface, used for the 2px ring that keeps end-dots legible. */
export const SURFACE = '#1b1e17'

/** Hairline grid, one step off the surface. Solid — never dashed. */
export const GRID = '#33372c'

export const AXIS_TEXT = '#948f7e'

export const AXIS_TICK = {
  fill: AXIS_TEXT,
  fontSize: 10,
  fontFamily: "'IBM Plex Mono', monospace",
} as const

/** Bars are capped rather than filling their band, leaving the slot some air. */
export const MAX_BAR_SIZE = 18

/** 4px rounded data-end, square at the baseline (horizontal bars grow right). */
export const BAR_RADIUS: [number, number, number, number] = [0, 4, 4, 0]
