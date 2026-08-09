/**
 * Assignment-specific playbooks, from the Vantage Africa winning-proposal
 * instructions.
 *
 * These are held apart from the base doctrine and selected per tender rather
 * than always sent. An education-sector-plan bid and a leadership-programme bid
 * need almost nothing from each other's playbook, and sending all six would
 * both cost tokens and blur the draft — a model given six methodologies tends
 * to produce a compromise of all of them.
 */

export interface Playbook {
  id: string
  label: string
  /** Lower-case terms matched against the tender title, service areas and notes. */
  triggers: string[]
  body: string
}

export const PLAYBOOKS: Playbook[] = [
  {
    id: 'evaluation',
    label: 'Evaluations and studies',
    triggers: [
      'evaluation',
      'evaluate',
      'end-term',
      'end term',
      'endline',
      'end-line',
      'midline',
      'baseline',
      'impact assessment',
      'outcome assessment',
      'final review',
      'oecd',
      'dac',
      'value for money',
      'assessment of',
      'survey',
      'research study',
      'needs assessment',
    ],
    body: `## Playbook: end-term, outcome and impact evaluations

An evaluation does not count activities. It establishes what changed, for whom,
by how much, where, why it did or did not happen, how the project contributed,
whether benefits will continue, and what should happen next.

Apply the frameworks the assignment calls for: OECD DAC criteria (relevance,
coherence, effectiveness, efficiency, impact, sustainability), theory-based
evaluation, contribution analysis, utilization-focused evaluation, mixed
methods, gender-responsive and equity lenses, outcome harvesting or
most-significant-change where suitable, baseline-to-endline comparison,
indicator verification, data quality assessment, and value-for-money analysis.

Set out the inception phase concretely: inception meeting, review of the project
proposal, Theory of Change, logframe and IPTT, baseline and previous
evaluations, progress reports and databases, and DQA findings; confirmation of
evaluation questions; evaluation matrix; sampling plan; tools; ethics and
safeguarding plan; piloting and revision; inception report.

For quantitative design, state the target population, sampling frame, sample
size calculation, confidence level, margin of error, design effect where
relevant, non-response allowance, stratification, geographic allocation,
beneficiary categories, baseline comparability, weighting, and disaggregation
(sex, age, disability, refugee/host status, location, enterprise type,
intervention exposure, vulnerability). Never state a sample size without the
justification that produced it — an unjustified number is a scoring liability.

For qualitative design, name the methods (KIIs, FGDs, in-depth interviews, case
studies, outcome harvesting, stakeholder mapping, observation, market-system
interviews, community validation, participatory ranking, journey mapping), who
participates in each, and why.

Cover field data quality explicitly: digital collection, enumerator selection
and training, tool piloting, skip logic, mandatory fields, range checks, daily
dashboard review, supervisor spot checks, back-checks, GPS and timestamps where
ethical, consent recording, secure devices, encryption, daily debriefs, query
resolution, audit trail.

Include an evaluation matrix as a table: criterion, key question,
indicators/measures, data source, method, analysis, disaggregation.

Typical deliverables: inception report, evaluation matrix, sampling plan,
approved tools, clean dataset, codebook, qualitative database, analysis syntax
where requested, preliminary findings presentation, validation workshop, draft
report, final report, executive summary, management-response matrix, learning
brief, case studies, slide deck.`,
  },

  {
    id: 'education-sector',
    label: 'Education sector analysis and planning',
    triggers: [
      'education sector analysis',
      'education sector strategic plan',
      'education sector plan',
      'esa',
      'essp',
      'sector plan',
      'education sector',
      'emis',
      'education policy',
      'school',
      'ministry of education',
      'curriculum reform',
      'education simulation',
    ],
    body: `## Playbook: education sector analysis and strategic planning

Workstreams: inception, governance and evidence audit; Education Sector
Analysis; end-of-cycle review of the current plan; stakeholder consultation;
problem prioritization; Theory of Change and strategic framework; programme
design; education simulation and costing; financing framework; implementation
arrangements; M&E framework; risk management; validation; appraisal readiness;
finalization and handover.

Cover the ESA domains the terms of reference reach: access and participation,
equity and inclusion, gender, disability, nomadic and pastoralist education,
IDPs, refugees, learning outcomes, early-grade reading and mathematics, teachers
and teaching quality, curriculum, infrastructure, education in emergencies,
governance, EMIS, financing, efficiency, TVET, higher education, non-formal
education, regional disparities, and climate and conflict risk.

Data integrity is scored here. Include the data inventory, source mapping,
consistency checks, missing-data assessment, triangulation, EMIS quality review,
administrative data reconciliation, population-denominator review, documented
limitations, and validation with technical teams.

The planning logic must be traceable end to end: evidence, priority problem,
root cause, strategic objective, programme, activity, cost, financing source,
indicator, responsibility, risk, review mechanism.

Where simulation and costing are required, address enrolment projections,
teacher requirements, classroom and infrastructure needs, unit costs, recurrent
and capital costs, scenario modelling, domestic and partner financing, funding
gap, sensitivity analysis, and the medium-term implementation plan. Do not claim
simulation expertise unless a qualified education economist or modeller has been
named to the team — flag it as a role to confirm instead.

In fragile and conflict-affected contexts, address security and access,
displacement, data gaps, interrupted learning, regional inequality, emergency
preparedness, remote consultation, local researcher engagement, conflict
sensitivity, safeguarding and continuity planning.

These bids usually demand documentary proof of directly similar national
assignments. Adjacent education training experience must never be presented as a
national sector-plan assignment — say plainly what was delivered and what
transfers.`,
  },

  {
    id: 'leadership',
    label: 'Leadership development and blended learning',
    triggers: [
      'leadership',
      'executive',
      'coaching',
      'mentorship',
      'mentoring',
      'management development',
      'talent',
      'lms',
      'scorm',
      'e-learning',
      'elearning',
      'digital learning',
      'blended learning',
      'bootcamp',
      'capstone',
      'simulation',
      'pandemic',
      'preparedness',
      'senior managers',
      'emerging leaders',
    ],
    body: `## Playbook: leadership development and blended learning

Never frame the assignment as a calendar of workshops. Use the transformation
cycle: assess, design, learn, apply, coach, reflect, reassess, personalize,
institutionalize, measure. Behaviour changes when participants understand
expectations, receive feedback, practise, apply at work, are coached, learn from
peers, reflect, are reassessed, and sustain new routines.

Where the audiences differ, build distinct pathways under one shared leadership
language — executives, senior management, middle managers, supervisors, emerging
leaders, researchers, scientists, young professionals, network leaders. For each
pathway state the primary role, competencies, delivery format, contact time,
coaching, assignments, assessment and expected output.

Draw the architecture from: curriculum design workshop, competency framework,
baseline assessment, self-paced e-learning, virtual learning labs, face-to-face
bootcamps, individual and group coaching, mentorship, peer learning circles,
workplace assignments, reflection journals, simulation, capstone project,
endline assessment, sustainability plan.

For pandemic preparedness and response, contextualize the leadership content
around systems thinking, strategic foresight, scientific leadership, crisis
decision-making, risk communication, public trust, research collaboration,
science diplomacy, policy influence, stakeholder coordination, governance, data
and evidence, institutional resilience, adaptive leadership, cross-border
collaboration, ethics under uncertainty, innovation, and succession.

Where SCORM or an LMS is in scope, address storyboarding, learning objectives,
multimedia production, mobile responsiveness, accessibility, knowledge checks,
quizzes, reflection exercises, downloadable resources, SCORM packaging, LMS
upload and configuration, user acceptance testing, browser and device testing,
learner analytics, administrator guide, troubleshooting and source-file
handover — and name a qualified instructional designer. Do not claim SCORM or
LMS production capability without evidence; mark it as a capability to confirm.

Coaching design: coaching framework, matching process, confidentiality, ethics,
personal leadership development plan, session cadence and preparation, action
commitments, progress tracking, escalation boundaries, and aggregate reporting
that protects confidentiality. Where recognized coaching certification is
required, it must be evidenced, not asserted.

Measurement: baseline and endline self-assessment, 360-degree appraisal,
knowledge checks, assignment quality, participation, coaching progress,
behavioural indicators, supervisor and peer feedback, capstone results,
Kirkpatrick Levels 1-4, institutional outcomes, community-of-practice activity.`,
  },

  {
    id: 'curriculum',
    label: 'Curriculum, modules and training of trainers',
    triggers: [
      'curriculum',
      'module',
      'training of trainers',
      'tot',
      'facilitator guide',
      'job aid',
      'training manual',
      'content development',
      'training package',
      'counselling',
      'instructional design',
      'training needs',
    ],
    body: `## Playbook: curriculum, module and training-of-trainers development

Sequence: inception and evidence review; user and context analysis; competency
and learning-outcome definition; content architecture; draft module; job aids
and practical tools; facilitator guide; participant manual; assessment tools;
validation; revision; translation where required; print-ready and digital
production; training of trainers; teach-back; post-training support; final
handover.

Ground the method in adult learning: short concept inputs, demonstration, case
studies, role plays, simulations, guided practice, peer feedback, reflection,
teach-back, and workplace application.

Where the content is person-centered or sensitive — health, counselling, gender,
protection, vulnerable populations — address dignity, respect, empathy,
autonomy, shared decision-making, confidentiality, culturally appropriate
communication, safeguarding, referral pathways, low-literacy design and
inclusive visuals.

Typical deliverables: inception note, evidence-review summary, module outline,
final module, job aids, facilitator guide, participant manual, slide deck, case
studies, assessments, supervision checklist, mentorship plan, ToT report, and
editable source files.`,
  },

  {
    id: 'resource-mobilization',
    label: 'Resource mobilization and partnerships',
    triggers: [
      'resource mobilization',
      'resource mobilisation',
      'fundraising',
      'fund raising',
      'donor mapping',
      'partnership',
      'grant',
      'proposal development',
      'proposal writing',
      'business development',
      'sustainability strategy',
    ],
    body: `## Playbook: resource mobilization and partnerships

Do not frame the assignment as proposal writing alone. Present the system:
strategy, programme packaging, donor intelligence, pipeline, positioning
materials, engagement, proposal development, follow-up, learning,
institutionalization.

Components to draw on: resource-mobilization diagnostic, strategy review,
programme packaging, value proposition, donor mapping and database, opportunity
pipeline, go/no-go process, partnership strategy, engagement protocols, pitch
decks, concept notes, campaign concepts, proposal development, staff capacity
strengthening, partner event support, tools and handover.

Where a pipeline is a deliverable, specify its fields: donor, type, theme,
geography, funding size, eligibility, deadline, relationship, probability, next
action, owner, status, follow-up date, result, lesson.

Distinguish partner categories: funding, technical, implementation, government,
private sector, research, consortium.

The assignment must leave something behind — named owners, standard operating
procedures, templates, review meetings, a proposal calendar, a pipeline
dashboard, a learning log, and leadership oversight.`,
  },

  {
    id: 'meal',
    label: 'MEAL training and institutional systems',
    triggers: [
      'meal',
      'monitoring and evaluation',
      'm&e',
      'results framework',
      'logframe',
      'theory of change',
      'indicator',
      'data quality',
      'dashboard',
      'performance management',
      'performance measurement',
      'evidence system',
      'results-based',
      'data analysis',
      'management information system',
    ],
    body: `## Playbook: MEAL training and institutional systems

Connect the results architecture end to end: policy priorities, programmes and
projects, outputs, outcomes, evidence, decisions.

A strong proposal here produces artefacts, not a course: results chain, Theory of
Change, indicator bank, indicator reference sheets, baselines and targets, M&E
plan, data-collection tools, data-quality checklist, reporting calendar,
dashboard concept, governance map, SOP outline, and action plan.

Method: context review, practical input, guided application, tool building, peer
review, reflection, institutional follow-through.

Institutionalization must be addressed explicitly — people, roles, data
ownership, processes, reporting calendar, quality checks, technology, evidence
repository, dashboards, leadership meetings, follow-up actions, accountability.
Training that leaves no system behind scores poorly against sustainability.`,
  },

  {
    id: 'strategy-od',
    label: 'Strategy, HR and organizational development',
    triggers: [
      'strategic plan',
      'strategic planning',
      'strategy development',
      'organizational development',
      'organisational development',
      'institutional strengthening',
      'institutional review',
      'organizational review',
      'organisational review',
      'restructuring',
      'human resource',
      'hr policy',
      'staff establishment',
      'job evaluation',
      'salary review',
      'change management',
      'governance framework',
      'operating model',
      'business process review',
      'capability assessment',
      'succession planning',
    ],
    body: `## Playbook: strategy, HR and organizational development

The chain is diagnosis, strategy, structure, systems, capability, handover:
institutional diagnosis → capability and workforce analysis → strategy →
policies and tools → systems → training → implementation support and handover.

Diagnostic instruments to name where they fit: document and policy review,
institutional assessment against a stated capability model, stakeholder
analysis and consultation, SWOT and PESTLE, functional and workload analysis,
organizational structure and reporting-line review, staff establishment
analysis, skills and competency audit, business process mapping, culture and
staff engagement survey, benchmarking against comparable institutions. Name the
lens, the questions it asks, the method and the output — not the acronym alone.

Formulation work produces documents the client can adopt, not advice: vision,
mission and values; strategic pillars, objectives and results framework with
indicators, baselines and targets; implementation and costed action plan;
monitoring and reporting calendar; risk register; governance and oversight
model; organogram; job descriptions and person specifications; grading and
remuneration structure; HR policies and SOPs; performance-management framework;
capacity development plan.

Two things separate a scoring proposal here from a generic one. First,
consultation is a method, not a courtesy — specify who is consulted, at which
stage, through what instrument, and how their input changes the draft. Second,
adoption is a deliverable: name the validation workshop, the management review,
the board or council approval step, and the support offered to reach it.

Change management is explicit: communication plan, sponsorship and champions,
transition arrangements, staff engagement, training, and how resistance is
surfaced and handled. A structure that is approved but not staffed or funded is
a failed assignment; say how the plan is resourced and sequenced.`,
  },

  {
    id: 'digital-systems',
    label: 'Digital systems and software development',
    triggers: [
      'software development',
      'system development',
      'management information system',
      'mis development',
      'database development',
      'web application',
      'mobile application',
      'digital platform',
      'digital solution',
      'e-learning platform',
      'lms',
      'dashboard development',
      'automation',
      'portal',
      'system integration',
      'requirements gathering',
      'user acceptance testing',
      'digitization',
      'digitalization',
    ],
    body: `## Playbook: digital systems and software development

The chain is needs → process → requirements → architecture → build → test →
deploy → adopt: user needs assessment, business process mapping, functional and
non-functional requirements, architecture and data model, prototyping,
iterative build, testing and UAT, data migration, training, documentation,
deployment, and maintenance and handover.

Be specific where buyers score specificity. Requirements: functional
specification, user stories with acceptance criteria, a requirements
traceability matrix back to the ToR. Architecture: application and data
architecture, integration and API approach, hosting model, offline or
low-bandwidth handling where the context demands it. Build: environments
(development, staging, production), version control, sprint cadence and demo
schedule, change-request procedure.

Testing is named, not asserted: unit and integration testing, system testing,
performance and load testing, security testing, accessibility, and a structured
User Acceptance Testing cycle with the client's own testers, scripted cases,
defect log, severity classification and exit criteria.

Data protection is a scoring section, not a footnote: role-based access
control, authentication, encryption in transit and at rest, audit logging,
backup and disaster recovery with stated recovery objectives, data-retention
policy, and compliance with the client's own policy and applicable local data
protection law.

Handover decides sustainability. Commit to source code and repository transfer,
technical and administrator documentation, user manuals, training for
administrators and end users, a defined warranty or support period with
response times, and the licensing position on everything delivered. State
clearly what the client owns.`,
  },
]

/**
 * Picks the playbooks that fit a tender.
 *
 * Capped at two: most assignments genuinely sit at an intersection (an M&E
 * training with an evaluation component, say), but a draft told to follow four
 * methodologies at once reads as a menu rather than an approach.
 */
export function selectPlaybooks(haystack: string, limit = 2): Playbook[] {
  const text = haystack.toLowerCase()

  const scored = PLAYBOOKS.map((playbook) => ({
    playbook,
    // Longer triggers are more specific, so "education sector analysis" should
    // outweigh a passing mention of "school".
    score: playbook.triggers.reduce(
      (total, trigger) => (text.includes(trigger) ? total + trigger.length : total),
      0,
    ),
  }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, limit).map((entry) => entry.playbook)
}
