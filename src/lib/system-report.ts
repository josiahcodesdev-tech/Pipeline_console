import type { TableRow as DocxTableRow } from 'docx'
import { formatDateLong, today } from './dates'

/**
 * A status report on the console itself, for the super user to take to
 * management.
 *
 * Written as an inventory in this file rather than generated from the code,
 * because there is no honest way to derive "what can this system do" from a
 * build — a feature that exists but is unreachable, or reachable but not yet
 * deployed, reads identically to one that works. The distinction between the
 * three is the whole point of the document, so it is stated deliberately and
 * has to be maintained deliberately.
 *
 * The figures, by contrast, are read live. A capability list with invented
 * numbers beside it is worse than one with none.
 *
 * Every entry carries an example. "Sources opportunities automatically" tells a
 * reader nothing they can check; "a UNDP baseline notice published overnight is
 * in the tracker by 5am, tagged Monitoring & Evaluation (MEL)" tells them what
 * to look for and lets them catch it if it is untrue.
 */

/** Live counts, passed in so the document cannot invent them. */
export interface SystemSnapshot {
  members: number
  activeMembers: number
  tenders: number
  tendersInPipeline: number
  leads: number
  proposals: number
  activities: number
  callReports: number
  consultants: number
}

interface Capability {
  area: string
  what: string
  example: string
}

/** Working today. Anything whose server side is not deployed belongs below. */
const WORKING: Capability[] = [
  {
    area: 'Opportunity sourcing',
    what: 'Reads six tender sources on a schedule and files what fits, without anyone visiting a portal.',
    example:
      'World Bank, UNDP, UNGM, IUCN, AfDB and ReliefWeb are read at 5am. A notice published overnight is in the tracker before the working day, already tagged with the service it touches.',
  },
  {
    area: 'Relevance filtering',
    what: 'Discards work the firm does not sell before anyone reads it, and scores the rest for fit.',
    example:
      'Of roughly 300 notices held, about a third match a service. "Supply and installation of generators" is refused outright; "Integrated Baseline Assessment and development of the MEL framework" scores 100 and sorts to the top.',
  },
  {
    area: 'One bid per tender',
    what: 'A tender taken on by one member cannot be taken by another, firm-wide.',
    example:
      'Two officers browsing the same UNDP notice see the same row; the second is told who holds it rather than being allowed to start a competing response to the same buyer.',
  },
  {
    area: 'Proposal pipeline',
    what: 'Tracks live bids by stage with the figures management asks for.',
    example:
      'Open proposals, those closing within seven days, value at stake and win rate are on one screen. A bid with nothing logged against it is flagged "nothing logged" rather than sitting quietly.',
  },
  {
    area: 'Proposal drafting',
    what: 'Writes a full technical proposal against an attached tender document, following the firm\'s own template.',
    example:
      'Attach the ToR PDF and the drafter produces the twenty-three sections of the Vantage Africa master template — understanding, methodology, work plan, deliverables, team, compliance matrix — plus internal bid-readiness notes listing what the bid team must still supply.',
  },
  {
    area: 'Evidence discipline',
    what: 'Refuses to invent experience, and marks what it does not know.',
    example:
      'Where a reference or a contract value was not supplied, the draft carries [INSERT VERIFIED ASSIGNMENT] and lists it in the readiness notes, rather than producing a plausible figure that fails at due diligence.',
  },
  {
    area: 'Branded Word export',
    what: 'Produces a submission-formatted document, not a text dump.',
    example:
      'The export builds a typographic cover, a contents field, house colours, headers and page numbers, and renders tables and callouts — so a draft is edited rather than retyped.',
  },
  {
    area: 'Client visits and call reports',
    what: 'Files management\'s call report against the visit that produced it, in management\'s own format.',
    example:
      'A visit logged against a client carries its own report. The client name, location, phone, contact and date of visit print from the record, so they are never retyped and cannot disagree with it. A second visit gets its own report rather than overwriting the first.',
  },
  {
    area: 'Communication log',
    what: 'Holds the daily evidence behind the client-communication KPI.',
    example:
      'Calls, emails, meetings and demos are logged by day with an outcome, and open leads never contacted are counted on the Activity page.',
  },
  {
    area: 'Weekly and periodic reporting',
    what: 'Assembles the lead-generation report for any week, month or quarter, and exports it to Word.',
    example:
      'New leads, qualifications, conversions, revenue supported, active tenders, communications logged and follow-up discipline are computed from the record rather than recalled.',
  },
  {
    area: 'Consultant roster',
    what: 'Holds the people proposals are staffed from, with photographs and CVs.',
    example:
      'The drafter staffs the team section by name from this roster, and flags a required specialist the roster does not cover instead of inventing one.',
  },
  {
    area: 'Access control',
    what: 'Three levels, enforced by the database rather than by hiding buttons.',
    example:
      'A standard user works their own pipeline. An admin sees the whole firm\'s. Only the super user adds members, sets access or deletes anything. Every rule is a row-level security policy, so it survives someone opening the browser console.',
  },
  {
    area: 'Oversight',
    what: 'Shows the whole firm\'s position without double-counting it.',
    example:
      'Each member holds their own copy of every scraped tender, so summing per-member figures counts one opportunity once per member. Firm-wide counts are computed in the database against distinct tenders instead.',
  },
]

/** Written and committed, waiting on a deploy or a migration to take effect. */
const BUILT_NOT_LIVE: Capability[] = [
  {
    area: 'Search aligned to the capability statement',
    what: 'The six services from the Corporate Capability Statement replace a home-grown label set that had drifted from it.',
    example:
      'Measured over every notice held: 102 matched before, 104 after, none lost. Takes effect when the sync function is deployed.',
  },
  {
    area: 'Clearing work the firm cannot do',
    what: 'Removes the tenders matching none of the six services.',
    example:
      '712 rows across 194 notices — blue-economy incubation, civil works, biodiversity reviews. Anything in a pipeline, holding a proposal, an activity or a claim is spared. Irreversible, so it waits for a deliberate decision.',
  },
  {
    area: 'Oversight acting on a held tender',
    what: 'Admin and super user can edit, draft and log against a bid a member has taken, and hand it to someone else.',
    example:
      'A bid abandoned mid-draft when someone goes on leave can be finished or reassigned — the tender, its proposals, its activity and its claim all move together. Waiting on migrations 0028 and 0029.',
  },
]

/** Not built. Stated plainly so nobody plans around a feature that is absent. */
const NOT_YET: Capability[] = [
  {
    area: 'Deadline reminders',
    what: 'Nothing tells anyone a tender is closing. The console shows it; it does not chase.',
    example:
      'A bid due on Friday appears in "closing within 7 days" only to whoever opens the page. There is no email, no notification and no digest.',
  },
  {
    area: 'Email of any kind',
    what: 'The project has no mail configured, which reaches further than it sounds.',
    example:
      'There is no "forgot password" link — a locked-out member waits for the super user to issue a new one by hand. A reassigned tender does not tell its new owner.',
  },
  {
    area: 'Financial proposals',
    what: 'The budget half of a bid is not built.',
    example:
      'The drafter deliberately keeps pricing out of the technical document and lists the commercial terms in the readiness notes instead. The budget itself is still assembled outside the console.',
  },
  {
    area: 'Version history on proposals',
    what: 'A draft is replaced, not versioned.',
    example:
      'Re-drafting produces a new record, but there is no way to compare it with the previous one or restore an earlier wording.',
  },
  {
    area: 'Full-text search of proposals',
    what: 'Search covers titles and organisations, not the body of past submissions.',
    example:
      'Finding "the methodology we used for the county M&E training" means opening candidates one at a time.',
  },
  {
    area: 'Audit trail',
    what: 'The record shows the current state, not who changed it or when.',
    example:
      'When oversight edits a member\'s bid the screen says whose it is, but nothing is written down afterwards and the member is not told.',
  },
  {
    area: 'CVs attached to generated proposals',
    what: 'The roster holds CVs; the export does not annex them.',
    example:
      'The team table is written from the roster, but the CV files are attached to the submission by hand.',
  },
  {
    area: 'Offline and mobile use',
    what: 'Built for a laptop on a connection.',
    example:
      'Usable on a phone screen, but a field officer without signal cannot log a visit and sync it later.',
  },
]

/** Things a reader should know before relying on the above. */
const CAVEATS: [string, string][] = [
  [
    'Drafting depends on an external service',
    'Proposal drafting calls the Claude API. If that account has no credit or the service is busy, drafting stops and reports why. Nothing else in the console is affected.',
  ],
  [
    'Sources can change without notice',
    'The six tender sources are read as they publish today. A site that changes its feed stops contributing until the connector is updated; the sync reports which source failed rather than failing silently.',
  ],
  [
    'A missed opportunity is invisible',
    'The relevance filter is written generously and is checked against real notices, but a tender phrased in wording it does not know is never seen. It cannot report what it did not import.',
  ],
  [
    'Deletion is final',
    'Removing a member deletes everything they own — leads, tenders, activities, proposals. Removing a tender takes its proposals and activity with it. Neither is archived.',
  ],
]

function snapshotRows(snapshot: SystemSnapshot): [string, string][] {
  return [
    ['Members with access', `${snapshot.activeMembers} of ${snapshot.members}`],
    ['Tenders held', String(snapshot.tenders)],
    ['Tenders being bid', String(snapshot.tendersInPipeline)],
    ['Clients and leads', String(snapshot.leads)],
    ['Proposals on record', String(snapshot.proposals)],
    ['Interactions logged', String(snapshot.activities)],
    ['Call reports filed', String(snapshot.callReports)],
    ['Consultants on the roster', String(snapshot.consultants)],
  ]
}

export function systemReportFileName(): string {
  return `Pipeline Console - capability report - ${today()}.docx`
}

export async function downloadSystemReportDocx(
  snapshot: SystemSnapshot,
): Promise<void> {
  const [
    {
      AlignmentType,
      BorderStyle,
      Document,
      HeadingLevel,
      Packer,
      Paragraph,
      Table,
      TableCell,
      TableRow,
      TextRun,
      WidthType,
    },
    { saveAs },
  ] = await Promise.all([import('docx'), import('file-saver')])

  const HAIRLINE = { style: BorderStyle.SINGLE, size: 2, color: 'D8D2C8' }
  const BORDERS = { top: HAIRLINE, bottom: HAIRLINE, left: HAIRLINE, right: HAIRLINE }

  const cell = (text: string, opts: { bold?: boolean; width: number }) =>
    new TableCell({
      width: { size: opts.width, type: WidthType.PERCENTAGE },
      borders: BORDERS,
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold: opts.bold })],
        }),
      ],
    })

  const twoColumn = (rows: [string, string][]): InstanceType<typeof Table> =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map(
        ([label, value]): DocxTableRow =>
          new TableRow({
            children: [cell(label, { bold: true, width: 38 }), cell(value, { width: 62 })],
          }),
      ),
    })

  /** Each capability as a heading, a sentence, and the example that proves it. */
  const capabilityBlocks = (items: Capability[]) =>
    items.flatMap((item) => [
      new Paragraph({
        spacing: { before: 260, after: 60 },
        children: [new TextRun({ text: item.area, bold: true })],
      }),
      new Paragraph({ children: [new TextRun(item.what)] }),
      new Paragraph({
        spacing: { before: 60 },
        indent: { left: 340 },
        children: [
          new TextRun({ text: 'Example. ', bold: true, italics: true }),
          new TextRun({ text: item.example, italics: true }),
        ],
      }),
    ])

  const heading = (text: string) =>
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 420, after: 120 },
      children: [new TextRun(text)],
    })

  const document = new Document({
    creator: 'Pipeline Console',
    title: 'Pipeline Console — capability report',
    description: 'What the system does today, and what it does not do yet',
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun('Pipeline Console — capability report')],
          }),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: `Vantage Africa School of Leadership · ${formatDateLong(today())}`,
                italics: true,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 240 },
            children: [
              new TextRun(
                'What the bid and lead management system does today, what is built and waiting to be switched on, and what it does not do yet. Figures are read from the live database at the moment of export; the capability lists are maintained by hand, because a feature that exists but is not deployed looks identical to one that works.',
              ),
            ],
          }),

          heading('1. The system as it stands'),
          twoColumn(snapshotRows(snapshot)),

          heading('2. What it does today'),
          ...capabilityBlocks(WORKING),

          heading('3. Built, waiting to be switched on'),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun(
                'Written and committed. Each needs a database migration or a function deployment before it takes effect.',
              ),
            ],
          }),
          ...capabilityBlocks(BUILT_NOT_LIVE),

          heading('4. What it does not do yet'),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun(
                'Stated plainly so that nobody plans around a capability that is absent.',
              ),
            ],
          }),
          ...capabilityBlocks(NOT_YET),

          heading('5. What to know before relying on it'),
          twoColumn(CAVEATS),

          new Paragraph({
            spacing: { before: 420 },
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({
                text: 'Prepared from the running system. Figures above are live; everything else is a written inventory and is only as current as its last revision.',
                italics: true,
                size: 18,
              }),
            ],
          }),
        ],
      },
    ],
  })

  saveAs(await Packer.toBlob(document), systemReportFileName())
}

/** The same content on screen, so the page is not a button with nothing behind it. */
export const SYSTEM_REPORT_SECTIONS = [
  { title: 'What it does today', items: WORKING },
  { title: 'Built, waiting to be switched on', items: BUILT_NOT_LIVE },
  { title: 'What it does not do yet', items: NOT_YET },
] as const
