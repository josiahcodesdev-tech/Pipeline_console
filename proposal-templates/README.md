# Proposal templates

Drop a template in this folder and the drafter writes into it.

**Two paths use this folder, and they use it differently.**

- **Draft proposal, on an RFP's page** — fills the designed `.html` template
  here and produces the house document: same stylesheet, same layout, same
  institutional images, this tender's words. Read
  [Designed HTML templates](#designed-html-templates) below; that is the path
  that matters most, and the one with a config file to write.
- **The quick draft in the Add/Edit RFP dialog** — writes Markdown, using the
  template's *text* as a structure and voice reference. That copy is compiled
  into the Edge Function, which is what the deploy step below is for.

## Adding one

1. Save the template here as `.md`, `.txt`, `.html`, `.htm` or `.docx`.
2. Rebuild the app, so the browser can fetch it: `npm run build`.
3. Deploy: `npm run deploy:fn concept-note`.

Steps two and three are for the two paths respectively, and neither is
optional. The designed path fetches the file over the network — vite.config.ts
serves this folder directly, so there is no second copy to keep in step, but a
build that predates the file will not serve it. The Markdown path compiles the
file's text into the Edge Function, so a template sitting here undeployed is a
template that drafter has never seen. `deploy:fn` runs the compile step for
you; `npm run templates:build` runs it alone if you want to check the result
first.

This is the trade that comes with keeping templates in the repo rather than
behind an upload form: adding one is a commit and a deploy, not a click.

## What the Markdown drafter does with it

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

---

# Designed HTML templates

Everything above is about a template as *structure and voice* — headings the
drafter follows and prose it imitates, reaching the drafter as text.

**This is what the Draft proposal button does.** The `.html` file is kept
whole and only its words are replaced, so the finished proposal carries the
original's cover, cards, tables, photographs and stylesheet. The design
survives because it is never rebuilt.

Mechanically: the browser fetches the file, reads it as a list of text slots
(`npm run templates:check` prints them), and asks the drafter for one section
at a time — nineteen calls for the template in this folder, three at a time.
The answers are written back into the elements they came from. Markup, classes,
inline styles and institutional images are never touched.

A saved draft stores the *answers*, not the document, and the proposal is
rebuilt from this folder each time somebody opens it. Two consequences worth
knowing: correcting the template improves every proposal already written from
it, and **renaming or deleting a template breaks the proposals written into
it** — they will refuse to open rather than render in some other design.

That path needs to know two things about your file that no parser can work out
on its own.

## Check a template before trusting it

```
npm run templates:check
```

It runs the real extractor over every `.html` here and prints what it found —
sections, how many text slots, and of what kind — then what it could not work
out. It exits non-zero when something needs a decision, so it can gate a
commit.

Run it when you add a template and again after editing one. The failures here
are all silent ones: a selector that matches nothing does not raise an error,
it leaves the previous client's name in the browser tab and the running footer
while the proposal itself reads perfectly.

## The sidecar config

Next to `my_template.html`, optionally `my_template.config.json`. Every field
has a default; supply only what differs.

```jsonc
{
  // Where the sections and their prose live. Defaults cover the common
  // containers — section, article, .page, .slide — and fall back to <body>
  // for a single-page template.
  "sectionSelector": "section.page",
  "contentSelector": ".page-inner",

  // Images whose wording is part of the picture. Matched against alt text.
  "assignmentSpecificImages": ["architecture", "dashboard"],

  // Images that are a rendered page rather than a picture — a consultant
  // profile laid out and exported as a JPEG. Replaced by cards the drafter
  // fills, because a picture of a page cannot be reworded.
  "rebuildAsTextImages": ["consultant profile"],

  // Where the client is named outside the prose.
  "furniture": {
    "brandName": ".brand b",
    "brandClient": ".brand small",
    "footerClient": ".footer span:nth-of-type(2)",
    "navLinks": "nav a",
    "remove": [".edit-note"]
  }
}
```

## Why the images need you

`templates:check` will list every image and refuse to decide. That is
deliberate, and it is the one part of this you cannot skip.

Nothing in HTML separates a photograph of your team in Rwanda from a diagram
captioned "Eval360 for a Ministry of Transport". Both are a JPEG with an alt
attribute. Guess "reusable" and a bid goes out carrying another client's name
in a picture, where no evidence rule can see it. Guess "assignment-specific"
and your own photographs are stripped from every proposal you send.

So you look once, per template, and write the answer down. Anything you list is
removed along with its frame, so no empty bordered box is left behind. Anything
you do not list is kept.

## What it will not do

The same evidence rules as above, and for the same reason. A figure, client
name or past assignment sitting in the template is not evidence — it belongs to
the document it was written for. This path replaces the words; it does not
license reusing them.
