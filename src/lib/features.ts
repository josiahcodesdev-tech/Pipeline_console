/**
 * Feature flags.
 *
 * Hidden rather than deleted: the code, the database tables and the Edge
 * Function prompts all stay in place, so turning one back on is a one-line
 * change here rather than a rebuild.
 */

/**
 * AI proposal drafting, and everything that exists only to steer it — the
 * Guidance page, the model-answer stars, and pasting a past proposal as
 * training material.
 *
 * Off for now. Already-saved proposals stay visible and downloadable, and
 * uploading a sent proposal still works: those are bid history, not drafting.
 */
export const PROPOSAL_DRAFTING = false
