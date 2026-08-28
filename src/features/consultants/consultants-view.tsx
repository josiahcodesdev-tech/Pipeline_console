import { useState } from 'react'
import { LockIcon, PlusIcon, PencilIcon } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Panel, EmptyState, ViewHeader } from '@/shared/components/panel'
import { usePipeline } from '@/shared/hooks/use-pipeline'
import { useAuth } from '@/shared/hooks/use-auth'
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
  const { profile } = useAuth()
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
                {/* The roster is read by everyone and written by whoever
                    owns the row — see migration 0044. Showing Edit on a
                    colleague's consultant would be a button the server
                    refuses, so it is a quiet label instead: the reader still
                    learns why they cannot change it. */}
                {person.ownerId === profile?.id ? (
                  <button
                    type="button"
                    onClick={() => open(person)}
                    aria-label={`Edit ${person.name}`}
                    title="Edit"
                    className="shrink-0 cursor-pointer rounded-md p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                ) : (
                  <span
                    title="Added by a colleague. You can put them on a proposal, but only they can edit the record."
                    className="shrink-0 rounded-md p-1.5 text-faint"
                  >
                    <LockIcon className="size-3.5" />
                  </span>
                )}
              </div>

              {/* The photograph and the CV lead the card.
                  On the card rather than in the edit dialog: a file needs a
                  saved row to attach to, and uploading is not something that
                  should be undone by cancelling out of a form. They sit at the
                  top because a consultant record is a person — the face and the
                  CV are what a bid manager checks first, and both are what a
                  tender asks for as an annex. */}
              <div className="mt-3">
                <ConsultantFiles consultant={person} onSet={setConsultantFile} />
              </div>

              <div className="mt-4">
                <Tags value={person.coreExpertise} />
              </div>

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

              {(person.sectors.trim() || person.countries.trim()) && (
                <p className="mt-3 border-t border-border pt-2 text-[10.5px] text-faint">
                  {[person.sectors, person.countries].filter(Boolean).join(' · ')}
                </p>
              )}

              {/* Last, deliberately. The bio is the longest thing on the card
                  and the least scanned — everything above it answers "is this
                  the right person", and the prose is what you read once you
                  have decided to look. */}
              {person.shortBio.trim() && (
                <div className="mt-3">
                  <div className="eyebrow mb-1 text-faint">Short bio</div>
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                    {person.shortBio}
                  </p>
                </div>
              )}

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
