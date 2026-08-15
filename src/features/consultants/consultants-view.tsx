import { useState } from 'react'
import { PlusIcon, PencilIcon } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Panel, EmptyState, ViewHeader } from '@/shared/components/panel'
import { usePipeline } from '@/shared/hooks/use-pipeline'
import type { Consultant } from '@/domain/types'
import { ConsultantFiles } from './consultant-files'
import { ConsultantDialog } from './consultant-dialog'

/** Comma-separated free text rendered as chips. */
function Tags({ value }: { value: string }) {
  const tags = value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
  if (tags.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-md bg-brand-soft px-1.5 py-0.5 text-[10.5px] text-primary"
        >
          {tag}
        </span>
      ))}
    </div>
  )
}

/**
 * The people a proposal can be staffed with.
 *
 * Cards rather than a table: the useful fields here are paragraphs — task fit,
 * bios, project experience — and a table of those is unreadable at any width.
 */
export function ConsultantsView() {
  const { consultants, saveConsultant, setConsultantFile, removeConsultant } =
    usePipeline()
  const [editing, setEditing] = useState<Consultant | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  function open(consultant: Consultant | null) {
    setEditing(consultant)
    setDialogOpen(true)
  }

  const incomplete = consultants.filter(
    (person) => !person.shortBio.trim() || !person.taskFit.trim(),
  ).length

  return (
    <>
      <ViewHeader
        eyebrow="Bid resources"
        title="Consultants"
        description="Who the proposal drafter can staff a bid with. Task fit and the short bio are what it reads when it builds the team composition section, so keep them specific — precise skills beat a general profile."
        meta={
          <span className="text-[11px] text-muted-foreground">
            {consultants.length} {consultants.length === 1 ? 'consultant' : 'consultants'}
            {incomplete > 0 ? ` · ${incomplete} incomplete` : ''}
          </span>
        }
        action={
          <Button onClick={() => open(null)}>
            <PlusIcon />
            Add consultant
          </Button>
        }
      />

      {consultants.length === 0 ? (
        <Panel>
          <EmptyState hint="Until someone is added here, the drafter writes the team composition section entirely in placeholders — it has no one to put forward.">
            No consultants yet
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid gap-3.5 lg:grid-cols-2">
          {consultants.map((person) => (
            <Panel key={person.id}>
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-[15px] leading-tight text-foreground">
                    {person.name}
                  </h3>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {[
                      person.title,
                      person.yearsExperience !== null
                        ? `${person.yearsExperience} yrs`
                        : '',
                      person.availability,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No title set'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => open(person)}
                  aria-label={`Edit ${person.name}`}
                  title="Edit"
                  className="shrink-0 cursor-pointer rounded-md p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <PencilIcon className="size-3.5" />
                </button>
              </div>

              <Tags value={person.coreExpertise} />

              {person.taskFit.trim() ? (
                <div className="mt-3">
                  <div className="eyebrow mb-1 text-faint">Task fit</div>
                  <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted-foreground">
                    {person.taskFit}
                  </p>
                </div>
              ) : (
                // Named rather than left blank: without task fit the drafter has
                // little to match on, which is the whole point of the record.
                <p className="mt-3 text-[11.5px] text-warning">
                  No task fit set — the drafter has little to match this person on.
                </p>
              )}

              {person.shortBio.trim() && (
                <div className="mt-3">
                  <div className="eyebrow mb-1 text-faint">Short bio</div>
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                    {person.shortBio}
                  </p>
                </div>
              )}

              {(person.sectors.trim() || person.countries.trim()) && (
                <p className="mt-3 border-t border-border pt-2 text-[10.5px] text-faint">
                  {[person.sectors, person.countries].filter(Boolean).join(' · ')}
                </p>
              )}

              {/* On the card rather than in the edit dialog: a file needs a
                  saved row to attach to, and uploading is not something that
                  should be undone by cancelling out of a form. */}
              <div className="mt-4">
                <ConsultantFiles consultant={person} onSet={setConsultantFile} />
              </div>
            </Panel>
          ))}
        </div>
      )}

      <ConsultantDialog
        consultant={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={saveConsultant}
        onDelete={removeConsultant}
      />
    </>
  )
}
