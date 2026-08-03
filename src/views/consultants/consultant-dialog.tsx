import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldRow } from '@/components/field'
import type { ConsultantDraft } from '@/lib/db'
import { EMPTY_CONSULTANT, type Consultant } from '@/lib/types'

function toDraft(consultant: Consultant): ConsultantDraft {
  const { id: _id, ...draft } = consultant
  return draft
}

export function ConsultantDialog({
  consultant,
  open,
  onOpenChange,
  onSave,
  onDelete,
}: {
  consultant: Consultant | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (draft: ConsultantDraft, existing: Consultant | null) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [draft, setDraft] = useState<ConsultantDraft>(EMPTY_CONSULTANT)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setDraft(consultant ? toDraft(consultant) : EMPTY_CONSULTANT)
  }, [open, consultant])

  function set<K extends keyof ConsultantDraft>(key: K, value: ConsultantDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function handleSave() {
    if (!draft.name.trim()) {
      toast.error('Name is required')
      return
    }
    setBusy(true)
    try {
      await onSave({ ...draft, name: draft.name.trim() }, consultant)
      onOpenChange(false)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!consultant) return
    setBusy(true)
    try {
      await onDelete(consultant.id)
      onOpenChange(false)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-display">
            {consultant ? 'Edit consultant' : 'Add consultant'}
          </DialogTitle>
        </DialogHeader>

        <div>
          <FieldRow>
            <Field label="Full name" htmlFor="consultant-name">
              <Input
                id="consultant-name"
                value={draft.name}
                onChange={(event) => set('name', event.target.value)}
                className="w-full"
              />
            </Field>
            <Field label="Title / role" htmlFor="consultant-title">
              <Input
                id="consultant-title"
                value={draft.title}
                onChange={(event) => set('title', event.target.value)}
                placeholder="Senior MEL Specialist"
                className="w-full"
              />
            </Field>
          </FieldRow>

          <Field label="Core expertise" htmlFor="consultant-expertise">
            <Input
              id="consultant-expertise"
              value={draft.coreExpertise}
              onChange={(event) => set('coreExpertise', event.target.value)}
              placeholder="Monitoring & Evaluation, Youth Leadership, Grant Writing"
              className="w-full"
            />
          </Field>

          <FieldRow>
            <Field label="Years of experience" htmlFor="consultant-years">
              <Input
                id="consultant-years"
                type="number"
                min={0}
                value={draft.yearsExperience ?? ''}
                onChange={(event) =>
                  set(
                    'yearsExperience',
                    event.target.value === '' ? null : Number(event.target.value),
                  )
                }
                className="w-full"
              />
            </Field>
            <Field label="Availability" htmlFor="consultant-availability">
              <Input
                id="consultant-availability"
                value={draft.availability}
                onChange={(event) => set('availability', event.target.value)}
                placeholder="Retainer / Ad-hoc per project"
                className="w-full"
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Sectors" htmlFor="consultant-sectors">
              <Input
                id="consultant-sectors"
                value={draft.sectors}
                onChange={(event) => set('sectors', event.target.value)}
                placeholder="Education, Governance, Health"
                className="w-full"
              />
            </Field>
            <Field label="Countries / regions" htmlFor="consultant-countries">
              <Input
                id="consultant-countries"
                value={draft.countries}
                onChange={(event) => set('countries', event.target.value)}
                placeholder="Kenya, Uganda, East Africa"
                className="w-full"
              />
            </Field>
          </FieldRow>

          {/* The field the drafter weights most heavily when picking a team —
              it is written in the language of the work rather than the person. */}
          <Field label="Task fit" htmlFor="consultant-task-fit">
            <Textarea
              id="consultant-task-fit"
              value={draft.taskFit}
              onChange={(event) => set('taskFit', event.target.value)}
              placeholder={
                'The RFP components this person should be put forward for, one per line:\n' +
                'Lead facilitator for leadership training curricula\n' +
                'MEL framework design and logframe development'
              }
              className="min-h-[86px] w-full"
            />
          </Field>

          <Field label="Qualifications" htmlFor="consultant-qualifications">
            <Textarea
              id="consultant-qualifications"
              value={draft.qualifications}
              onChange={(event) => set('qualifications', event.target.value)}
              placeholder="MA Development Studies, University of Nairobi, 2014&#10;PRINCE2 Practitioner, 2019"
              className="min-h-[70px] w-full"
            />
          </Field>

          <Field label="Relevant project experience" htmlFor="consultant-projects">
            <Textarea
              id="consultant-projects"
              value={draft.projectExperience}
              onChange={(event) => set('projectExperience', event.target.value)}
              placeholder="Project — Funder, role, year. What they did and what it produced."
              className="min-h-[96px] w-full"
            />
          </Field>

          <Field label="Languages" htmlFor="consultant-languages">
            <Input
              id="consultant-languages"
              value={draft.languages}
              onChange={(event) => set('languages', event.target.value)}
              placeholder="English, Kiswahili, French"
              className="w-full"
            />
          </Field>

          <Field label="Short bio — for team composition (~50 words)" htmlFor="consultant-short-bio">
            <Textarea
              id="consultant-short-bio"
              value={draft.shortBio}
              onChange={(event) => set('shortBio', event.target.value)}
              className="min-h-[80px] w-full"
            />
          </Field>

          <Field label="Long bio — for a CV annex (~150 words)" htmlFor="consultant-long-bio">
            <Textarea
              id="consultant-long-bio"
              value={draft.longBio}
              onChange={(event) => set('longBio', event.target.value)}
              className="min-h-[110px] w-full"
            />
          </Field>
        </div>

        <div className="mt-1 flex items-center justify-between gap-3">
          {consultant ? (
            <Button variant="ghost" onClick={() => void handleDelete()} disabled={busy}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
