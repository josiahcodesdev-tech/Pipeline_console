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
const CONSULTANCY = [
  "consultan", "consulting", "expression of interest", "request for proposal",
  "technical assistance", "advisory", "advisor", "adviser", "specialist",
  "expert", "feasibility", "study", "studies", "assessment", "evaluation",
  "evaluator", "review", "survey", "baseline", "endline", "midterm",
  "mid-term", "research", "analysis", "diagnostic", "audit", "strategy",
  "strategic plan", "design of", "scoping", "mapping", "due diligence",
  "monitoring and evaluation", "monitoring & evaluation", "m&e", "mel ",
  "knowledge management", "policy development", "institutional support",
  "individual consultant", "firm to conduct", "terms of reference",
]

const TRAINING = [
  "training", "capacity building", "capacity development", "capacity-building",
  "workshop", "curriculum", "e-learning", "elearning", "learning and development",
  "coaching", "mentorship", "mentoring", "facilitation", "facilitator",
  "trainer", "course", "certification", "skills development", "upskilling",
  "training of trainers", "tot ", "seminar", "short course", "induction",
  // Corporate and institutional capacity building. Banks, SOEs and companies
  // describe the same work in HR language rather than development language —
  // "leadership development" and "organisational development" are the private
  // sector's words for capacity building, and without them these assignments
  // were being filtered out of feeds that already carried them.
  "staff training", "employee training", "professional development",
  "leadership development", "management development", "executive education",
  "organisational development", "organizational development",
  // "institutional development" is deliberately absent: it names a whole class
  // of donor project ("Water Sector Institutional Development Project") and
  // tagged procurement audits as training.
  "institutional strengthening",
  "change management", "training needs assessment", "training manual",
  "training materials", "train the trainer", "knowledge transfer",
  "competency framework", "learning management system", "soft skills",
  "technical training", "refresher course", "capacity assessment",
  "performance management", "talent development", "human resource development",
]

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
 * Does this notice describe consultancy or training work?
 *
 * Sources that can filter structurally should do so instead — World Bank's
 * `procurement_group=CS` is a far better signal than any keyword list. This is
 * for the sources that hand over everything and leave the sorting to us.
 */
export function isRelevant(...parts: string[]): boolean {
  const haystack = parts.join(" ").toLowerCase()
  if (!haystack.trim()) return false
  if (NOT_OUR_WORK.some((term) => haystack.includes(term))) return false
  return (
    CONSULTANCY.some((term) => haystack.includes(term)) ||
    TRAINING.some((term) => haystack.includes(term))
  )
}

/**
 * Tags the row with the kind of work it is, which is what the tracker's service
 * area filter offers — "is this a training contract or an evaluation?".
 *
 * A notice can carry more than one: a baseline study that also delivers a
 * training workshop is genuinely both, and forcing a single label would lose
 * that. Untagged is a real answer too — plenty of consultancy fits none of
 * these, and inventing a category for it would make the filter lie.
 */
export function serviceAreasFor(...parts: string[]): string {
  const haystack = parts.join(" ").toLowerCase()
  const areas: string[] = []
  const any = (...terms: string[]) => terms.some((t) => haystack.includes(t))

  // Reuses the relevance vocabulary rather than keeping a second, narrower copy
  // of it. They had drifted: corporate wording like "leadership development"
  // was good enough to let a notice IN, but not to tag it as training, so it
  // arrived and then hid from the training filter.
  if (TRAINING.some((term) => haystack.includes(term))) {
    areas.push("Training & Capacity Building")
  }
  // Bare "monitoring" is deliberately absent — it caught construction and
  // environmental monitoring, which are not this line of work. "impact
  // assessment" is out for the same reason: in these feeds it is nearly always
  // an ESIA, not an impact evaluation.
  if (any(
    "monitoring and evaluation", "monitoring & evaluation", "m&e", "mel ",
    "evaluation", "baseline", "endline", "midterm", "mid-term",
    "results framework", "learning agenda", "impact evaluation",
  )) {
    areas.push("Monitoring & Evaluation")
  }
  if (any("research", "study", "survey", "assessment", "analysis", "diagnostic", "mapping")) {
    areas.push("Research & Assessment")
  }
  if (any("strategy", "strategic plan", "policy", "institutional", "governance")) {
    areas.push("Strategy & Policy")
  }
  if (any("climate", "environment", "biodiversity", "conservation", "nature", "resilience")) {
    areas.push("Climate & Environment")
  }
  // The areas below exist mostly so the filter can be used the other way — to
  // put aside the engineering and ICT work this business does not bid on. With
  // only the five categories above, two thirds of the tracker was untagged and
  // therefore unreachable by any filter choice.
  if (any("procurement", "supply chain", "tendering", "bid evaluation", "sourcing")) {
    areas.push("Procurement")
  }
  if (any("audit", "financial management", "accounting", "actuarial", "taxation", "budgeting")) {
    areas.push("Finance & Audit")
  }
  if (any(
    "software", "digital", " ict", "information system", "database",
    "website", "web platform", "cyber", "data platform", "automation",
  )) {
    areas.push("ICT & Digital")
  }
  if (any("gender", "social inclusion", "disability", "safeguard", "gesi")) {
    areas.push("Gender & Inclusion")
  }
  if (any("communication", "media", "branding", "graphic design", "translation", "storytelling")) {
    areas.push("Communications")
  }
  if (any("engineering", "architect", "structural design", "feasibility", "supervision of works")) {
    areas.push("Engineering & Infrastructure")
  }
  if (any("health", "medical", "nutrition", "hiv", "malaria", "immunis", "immuniz")) {
    areas.push("Health")
  }
  if (any("education", "school", "teacher", "literacy", "curriculum")) {
    areas.push("Education")
  }
  return areas.join(", ")
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
