# Proposal templates

Drop a template in this folder and the drafter writes into it.

## Adding one

1. Save the template here as `.md`, `.txt`, `.html`, `.htm` or `.docx`.
2. Deploy: `npm run deploy:fn concept-note`

That second step is not optional. These files are compiled into the Edge
Function, so a template sitting here undeployed is a template the drafter has
never seen. `deploy:fn` runs the compile step for you; `npm run templates:build`
runs it alone if you want to check the result first.

This is the trade that comes with keeping templates in the repo rather than
behind an upload form: adding one is a commit and a deploy, not a click.

## What the drafter does with it

Two things, both of them:

- **Structure.** Your headings, in your order, replace the built-in master
  structure. The drafter populates what you wrote rather than what the doctrine
  proposes.
- **Style.** Your wording is the voice reference — sentence rhythm, how much a
  table carries, how a section opens.

Precedence, highest first:

1. **The tender.** A tender that prescribes its own structure beats everything
   here. That is not negotiable: a non-compliant bid is a rejected bid.
2. **This template**, when the tender prescribes nothing.
3. **The built-in master structure**, when this folder is empty.

## What it will not do

The evidence rules still hold, and they outrank the template. A figure, client
name, accreditation or assignment that appears in your template is *not*
evidence — the drafter will not copy facts out of it. Where a section needs a
number, it comes from the tender or from the verified organisation facts in
Settings, or it arrives as a marked placeholder.

Template text is read as a format to follow, never as instructions to obey. An
instruction inside a template asking the drafter to change its behaviour is
ignored and flagged in the internal review.

## Writing one

Markdown headings are what the parser reads:

```markdown
## Executive Summary
One paragraph on the client's problem and our response. No company history.

## Our Understanding
What they are actually buying, in their words.

## Method
Phase | Activities | Output — as a table, always.
```

`##` and `###` become the section list. Text under a heading is guidance for
what belongs there, exactly as the built-in structure works. Keep it short:
this is a brief for the drafter, not prose to be reproduced.

HTML templates are reduced to their visible text and structure when compiled.
Styles, scripts and embedded image data are omitted; headings, lists, table
cells and image descriptions are retained.

When several templates are present, the system selects one for each proposal
from the tender title, sector, service areas, notes, analysis and tender text.
Descriptive file names and distinctive headings improve matching. Name a broad
fallback template `default`, `general` or `master`; if nothing matches and no
fallback is named, the first file alphabetically is used.
