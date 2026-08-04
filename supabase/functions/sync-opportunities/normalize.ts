/**
 * Shared vocabulary for every source connector.
 *
 * Each source speaks its own dialect — World Bank returns JSON with ISO dates,
 * UNDP returns RSS 1.0 with "14-Aug-26" buried in prose, IUCN returns an HTML
 * table. They all land here as `Notice`, and the handler only ever sees that.
 */

/** One opportunity, after a connector has finished translating it. */
export interface Notice {
  /**
   * Globally unique and STABLE across runs — it is the dedup key.
   *
   * Always `source:id` (e.g. `worldbank:OP00456106`). The prefix matters: two
   * sources can and do reuse the same bare numeric id, and without it a UNDP
   * notice could silently suppress a World Bank one. It also keeps these clear
   * of the unprefixed ids the old CareerCraft sync wrote, so existing rows are
   * never mistaken for new ones.
   */
  externalId: string
  title: string
  org: string
  /** `YYYY-MM-DD`, or null when the source did not publish one. */
  deadline: string | null
  link: string
  /** Free text — country or duty station. Shown in notes. */
  location: string
  /** Display name, e.g. "World Bank". Shown in the source column. */
  source: string
  /** "rfp" or "job" — the feed's own framing, used for the type filter. */
  opportunityType: string
  /** Comma-joined service areas, e.g. "Monitoring & Evaluation, Training". */
  serviceAreas: string
  /** How well it fits what this firm does, 0-100. See scoreFit. */
  fitScore: number
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", hellip: "…", eacute: "é", egrave: "è",
}

/** Feeds routinely ship entities intact ("Rwanda&apos;s"), which would show literally. */
export function decodeEntities(input: string): string {
  if (!input.includes("&")) return input
  return input
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
}

/**
 * Flattens an HTML fragment to readable text.
 *
 * The scraped sources hand us markup in fields we want to read as prose —
 * World Bank's `notice_text` is a full HTML table. Block-level tags become
 * spaces so words either side do not fuse into "SpecialistProcurement".
 */
export function stripTags(input: string): string {
  return decodeEntities(
    input
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const pad = (n: number) => String(n).padStart(2, "0")

/**
 * Best-effort date parsing across every shape these sources publish.
 *
 * Deliberately tolerant, because the alternative is dropping otherwise-good
 * notices over a formatting quirk: a missing deadline still shows in the
 * tracker, it just does not sort by urgency. Anything unrecognised returns
 * null rather than a guess — a wrong deadline is worse than no deadline.
 *
 * Two-digit years are read as 20xx. These are live tenders, so a notice
 * closing in "26" is 2026 and never 1926.
 *
 * Numeric `x/y/z` dates are read DAY-first. Every source here is European,
 * UN or African, all of which write 07/08/2026 as 7 August. If a US-format
 * source is ever added this is the line to revisit.
 */
export function parseDate(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null

  // Already ISO, with or without a time component.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  // 14-Aug-26 · 14-Aug-2026 · 14 Aug 2026 · 20 July 2026
  const dmy = raw.match(/(\d{1,2})[\s\-/]+([A-Za-z]{3,})[\s\-/]+(\d{2,4})/)
  if (dmy) {
    const month = MONTHS[dmy[2].slice(0, 3).toLowerCase()]
    if (month) {
      const day = Number(dmy[1])
      let year = Number(dmy[3])
      if (year < 100) year += 2000
      if (day >= 1 && day <= 31) return `${year}-${pad(month)}-${pad(day)}`
    }
  }

  // August 14, 2026 · Aug 14 2026
  const mdy = raw.match(/([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/)
  if (mdy) {
    const month = MONTHS[mdy[1].slice(0, 3).toLowerCase()]
    if (month) {
      const day = Number(mdy[2])
      if (day >= 1 && day <= 31) return `${Number(mdy[3])}-${pad(month)}-${pad(day)}`
    }
  }

  // 14/08/2026 · 14-08-2026 — day first, see above.
  const numeric = raw.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (numeric) {
    const day = Number(numeric[1])
    const month = Number(numeric[2])
    let year = Number(numeric[3])
    if (year < 100) year += 2000
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${pad(month)}-${pad(day)}`
    }
  }

  return null
}

/**
 * Guesses the buyer segment from the organization name and title.
 *
 * Ordered most-specific first: "Ministry of Health Foundation Trust" should
 * read as Government, not NGO. A wrong guess is cheap — the segment is
 * editable in the RFP dialog. Mirrors classifySegment in src/lib/opportunities.ts.
 */
export function classifySegment(organization: string, title = ""): string {
  const haystack = `${organization} ${title}`.toLowerCase()
  const has = (...needles: string[]) => needles.some((n) => haystack.includes(n))

  if (has(
    "undp", "unicef", "unesco", "unhcr", "unfpa", "unops", "unep", "unido",
    "united nations", "world bank", "world health", "who ", "wfp", "fao",
    "ilo", "iom", "usaid", "giz", "sida", "danida", "norad", "dfid", "fcdo",
    "european union", "african development bank", "afdb", "gavi",
    "global fund", "development partner", "unwomen", "un women", "iucn",
    "international union for conservation",
  )) return "Development Partner"

  if (has(
    "ministry", "county government", "county of", "government of", "republic of",
    "state department", "national treasury", "public service", "parliament",
    "commission", "regulatory authority", "municipal", "city council",
  )) return "Government"

  if (has("university", "college", "polytechnic", "school of", "institute of technology")) {
    return "University"
  }

  if (has(
    "foundation", "trust", "ngo", "non-governmental", "charity", "relief",
    "red cross", "oxfam", "save the children", "care international",
    "world vision", "plan international", "mercy corps", "caritas",
  )) return "NGO"

  if (has(
    "authority", "corporation", "parastatal", "state corporation",
    "kenya power", "kenya airways", "kenya ports", "national oil",
  )) return "SOE"

  if (has(" ltd", "limited", " plc", " inc", "holdings", "group", "bank", "insurance")) {
    return "Corporate"
  }

  return "Government"
}

/** Drives the `kenya` column, which the tracker offers as a one-click filter. */
export function mentionsKenya(...parts: string[]): boolean {
  const haystack = parts.join(" ").toLowerCase()
  return /\bkenya\b|\bnairobi\b|\bkenyan\b/.test(haystack)
}

// ------------------------------------------------------------ relevance -----

/**
 * The work actually bid on: consultancy assignments and training contracts.
 *
 * Scope here is global, which means the raw firehose is tens of thousands of
 * notices — mostly roads, generators and school furniture. Without this filter
 * the tracker is unusable, so every source runs through it.
 */
/**
 * What Vantage Africa actually delivers, taken from vantageafricaleaders.com.
 *
 * This replaced a generic consultancy keyword list, which let in every advisory
 * assignment on earth — environmental impact studies, procurement specialists,
 * legal advisors, engineering design. All real consultancy; none of it work
 * this firm can bid. A tracker full of assignments you cannot deliver costs
 * more attention than it saves.
 *
 * One list, two jobs: it decides whether a notice is worth importing at all,
 * and it supplies the service-area tag. Those were previously separate
 * vocabularies and they drifted — corporate wording was good enough to let a
 * notice in but not to tag it, so it arrived and then hid from its own filter.
 * Keeping them as one map means that cannot happen again.
 *
 * `label` is what appears in the tracker's service-area filter.
 */
const CAPABILITIES: ReadonlyArray<{ label: string; weight: number; terms: readonly string[] }> = [
  {
    // The flagship. Eval 360, VAMEPA and most of the case studies sit here.
    label: "Monitoring & Evaluation",
    weight: 10,
    terms: [
      "monitoring and evaluation", "monitoring & evaluation", "m&e", "mel ",
      "meal ", "evaluation", "evaluator", "baseline", "endline", "midterm",
      "mid-term", "logframe", "logical framework", "theory of change",
      "results framework", "results-based", "impact evaluation", "indicator",
      "performance tracking", "learning agenda", "accountability and learning",
    ],
  },
  {
    label: "Leadership & Governance",
    weight: 9,
    terms: [
      "leadership", "governance", "board development", "board training",
      "executive development", "executive education", "management development",
      "supervisory skills", "management training", "corporate governance",
    ],
  },
  {
    label: "Project Management",
    weight: 6,
    terms: [
      "project management", "programme management", "program management",
      "project planning", "project cycle", "contract management",
      "prince2", "pmp ", "project implementation support",
    ],
  },
  {
    // Data work specifically, NOT research in general. A first pass had bare
    // "survey", "study", "assessment" and "research" here and this became a
    // catch-all: it matched 27 of 49 notices, among them a land survey and an
    // environmental impact assessment. Baseline and endline surveys are still
    // caught — by Monitoring & Evaluation, where they belong.
    label: "Data & Analysis",
    weight: 6,
    terms: [
      "data analysis", "data analytics", "data science", "business intelligence",
      "dashboard", "data visualisation", "data visualization",
      "statistical analysis", "data management", "data quality",
      "data collection tool", "survey design", "research design",
      "knowledge product", "data system",
    ],
  },
  {
    label: "Proposal Writing & Fundraising",
    weight: 6,
    terms: [
      "proposal writing", "fundraising", "fund raising", "resource mobilisation",
      "resource mobilization", "grant writing", "grant management",
      "donor engagement", "concept note", "bid writing",
    ],
  },
  {
    label: "Digital & AI Skills",
    weight: 5,
    terms: [
      "digital skills", "digital literacy", "artificial intelligence",
      "ai-augmented", "e-learning", "elearning", "learning management system",
      "digital productivity", "digital transformation",
    ],
  },
  {
    label: "Institutional Capacity Building",
    weight: 8,
    terms: [
      "capacity building", "capacity development", "capacity-building",
      "capacity assessment", "capacity strengthening", "institutional strengthening",
      "organisational development", "organizational development",
      "systems strengthening", "institutional support", "change management",
      "knowledge management", "knowledge transfer",
    ],
  },
  {
    label: "Strategy & Performance",
    weight: 7,
    terms: [
      "strategic plan", "strategy development", "strategic management",
      "performance management", "performance improvement", "appraisal",
      "balanced scorecard", "policy development", "operational review",
      "institutional performance", "competency framework",
    ],
  },
  {
    label: "Training & Facilitation",
    weight: 10,
    terms: [
      "training", "curriculum", "workshop", "facilitation", "facilitator",
      "trainer", "train the trainer", "training of trainers",
      "skills development", "upskilling", "short course", "certification",
      "coaching", "mentorship", "mentoring", "seminar", "induction",
      "staff training", "employee training", "professional development",
      "training needs assessment", "training manual", "training materials",
      "refresher course", "soft skills",
    ],
  },
]

/** Every capability this notice touches, by label. Empty means out of scope. */
export function matchCapabilities(...parts: string[]): string[] {
  const haystack = parts.join(" ").toLowerCase()
  if (!haystack.trim()) return []
  return CAPABILITIES.filter((capability) =>
    capability.terms.some((term) => haystack.includes(term)),
  ).map((capability) => capability.label)
}

/**
 * The weight at which a notice counts as a perfect fit.
 *
 * Calibrated against a live run rather than reasoned about. The first attempt
 * used 25 — roughly three capabilities — and produced 26 "Partial" out of 27,
 * including a Monitoring and Evaluation Specialist role, which is as central to
 * this firm as an opportunity gets. The fault was assuming notices name several
 * capabilities; a tender title is a dozen words and usually names one.
 *
 * At 18, one flagship capability (weight 10) lands near 56 and reads as a good
 * fit, two together reach 100 and read as strong, and a peripheral match like
 * project management alone sits around 33 and reads as partial. That matches
 * how these opportunities actually differ.
 */
const PERFECT_FIT = 18

/**
 * How well an opportunity fits, 0-100, for ranking the tracker.
 *
 * Filtering already answers "can we do this at all?"; every row that survives
 * is biddable. This answers the next question — which of them first — because
 * a week's worth arriving as an undifferentiated list still leaves the triage
 * to be done by hand.
 *
 * The score sums the weights of the capabilities matched, so it rewards both
 * strength of fit (an evaluation outranks a digital-skills course, because
 * evaluation is what this firm is known for) and breadth (a tender wanting
 * evaluation AND training AND capacity building outranks one wanting only the
 * first). It is a ranking heuristic, not a probability of winning, and it
 * deliberately ignores deadline and value — those are separate questions the
 * tracker already sorts and shows.
 */
export function scoreFit(...parts: string[]): number {
  const haystack = parts.join(" ").toLowerCase()
  if (!haystack.trim()) return 0
  const total = CAPABILITIES.filter((capability) =>
    capability.terms.some((term) => haystack.includes(term)),
  ).reduce((sum, capability) => sum + capability.weight, 0)
  return Math.min(100, Math.round((total / PERFECT_FIT) * 100))
}

/**
 * Hard excludes, checked first.
 *
 * These beat any consultancy keyword because the overlap is real and always
 * goes the wrong way: "supply and installation of equipment" contains
 * "installation" work nobody here bids on, and "construction supervision
 * consultant" is a civil-engineering role, not this business.
 */
const NOT_OUR_WORK = [
  "supply and delivery", "supply and installation", "supply of", "procurement of",
  "construction of", "rehabilitation of", "upgrading of", "erection of",
  "civil works", "road works", "roadworks", "borehole", "drilling",
  "furniture", "vehicles", "motor vehicle", "laptops", "computers",
  "stationery", "catering", "cleaning services", "security services",
  "security guard", "guard services", "janitorial", "maintenance of",
  "insurance services", "fuel supply", "medical supplies", "pharmaceutical",
  "spare parts", "generator", "air conditioning", "printing of",
  "construction supervision", "resident engineer", "quantity surveyor",
  "contract award", "invitation for bids", "general procurement notice",
  // Housekeeping posts the portals publish alongside real tenders. They match
  // the consultancy keywords ("expression of interest", "request for proposal")
  // without being work anyone can bid on, so they have to be named explicitly.
  "information session", "supplier session", "how to register",
  "vendor registration", "supplier registration", "roster of",
  "expression of interest for registration", "prequalification of suppliers",
  // Service contracts rather than advisory work.
  "travel", "logistics", "freight", "transport services", "courier",
  "hotel", "venue", "office supplies", "internet services", "telephone",
]

/**
 * Is this work Vantage Africa could actually bid and deliver?
 *
 * Two gates. The notice must not be something nobody here bids — goods, works,
 * a supplier registration drive — and it must touch at least one capability the
 * firm sells.
 *
 * That second gate is the change worth understanding. This used to ask only
 * "is it consultancy or training?", which is equally true of environmental
 * impact studies, engineering supervision and legal advisory, and every one of
 * those landed in the tracker to be read and discarded by hand. Requiring a
 * capability match is narrower on purpose: fewer notices, nearly all biddable.
 * A missed opportunity is a real cost, so CAPABILITIES is written generously
 * with synonyms — but a tracker nobody trusts enough to read is worse than a
 * slightly short one.
 */
export function isRelevant(...parts: string[]): boolean {
  const haystack = parts.join(" ").toLowerCase()
  if (!haystack.trim()) return false
  if (NOT_OUR_WORK.some((term) => haystack.includes(term))) return false
  return matchCapabilities(haystack).length > 0
}

/**
 * The service areas this notice touches, comma-joined for the tracker's filter.
 *
 * Deliberately the same capability map that decided the notice was relevant in
 * the first place. A row can therefore never be imported as training work and
 * then fail to appear under the training filter — which is exactly what
 * happened while these were two separate lists.
 *
 * A notice can carry several: a baseline study that also runs a workshop is
 * genuinely both, and forcing one label would lose that.
 */
export function serviceAreasFor(...parts: string[]): string {
  return matchCapabilities(...parts).join(', ')
}

/**
 * Notices older than this are ignored.
 *
 * The job runs daily, so a week of overlap is generous cover for a missed run
 * or a source that backdates its publication stamp, while still keeping the
 * per-run payload small. Re-seeing a notice costs nothing — `external_id` is
 * unique per user, so the insert is a no-op.
 */
export const LOOKBACK_DAYS = 7

export function withinLookback(published: string | null, now = new Date()): boolean {
  if (!published) return true // undated sources (IUCN) are filtered by deadline instead
  const stamp = Date.parse(`${published}T00:00:00Z`)
  if (Number.isNaN(stamp)) return true
  const age = (now.getTime() - stamp) / 86_400_000
  return age <= LOOKBACK_DAYS
}

/** Drops anything whose deadline has already passed — it cannot be bid on. */
export function stillOpen(deadline: string | null, now = new Date()): boolean {
  if (!deadline) return true
  const stamp = Date.parse(`${deadline}T23:59:59Z`)
  if (Number.isNaN(stamp)) return true
  return stamp >= now.getTime()
}
