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
 * On. Drafting runs in the `concept-note` Edge Function, so it needs that
 * deployed and OPENAI_API_KEY set as a function secret — the key is never in
 * the browser bundle.
 *
 * Turning this off hides the drafter and the model-answer stars but keeps
 * every saved proposal visible and downloadable: those are bid history, not
 * drafting.
 */
export const PROPOSAL_DRAFTING = true

/**
 * Pulling RFPs from the procurement sources — the scheduled 05:00 run, the sync
 * on page load, the manual "Check now" button, and the panel reporting on them.
 *
 * On. Sources are World Bank, UNDP, UNGM, IUCN and AfDB, with ReliefWeb waiting
 * on an approved appname; see supabase/functions/sync-opportunities/.
 *
 * Turning this off stops new rows arriving but removes nothing: anything
 * already synced stays exactly where it is, with its `sourced` flag untouched.
 * The 05:00 job is scheduled in the database rather than here, so switching
 * this off does NOT stop it — unschedule it too:
 *   select cron.unschedule('sync-opportunities-daily');
 */
export const OPPORTUNITY_SYNC = true
