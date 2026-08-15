import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { Field, FieldRow, SelectField } from '@/shared/components/field'
import { ConceptNoteDialog } from '@/shared/components/concept-note-dialog'
import type { RfpDraft } from '@/data/rfps'
import { RFP_STATUSES, SEGMENTS, type Rfp } from '@/domain/types'
import { DRAFT_LABELS, type ConceptNoteContext } from '@/services/concept-note'
import { useAuth } from '@/shared/hooks/use-auth'
import { safeExternalUrl } from './source-site'

const EMPTY: RfpDraft = {
  title: '',
  org: '',
  segment: 'Government',
  deadline: '',
  value: null,
  status: 'Watching',
  link: '',
  notes: '',
  source: 'Manual',
  opportunityType: '',
  kenya: false,
  serviceAreas: '',
  tenderText: '',
  tenderFileName: '',
  fitScore: 0,
}

function toDraft(rfp: Rfp): RfpDraft {
  const {
    id: _id,
    createdOn: _createdOn,
    statusUpdatedOn: _statusUpdatedOn,
    sourced: _sourced,
    ...draft
  } = rfp
  return draft
}

export function RfpDialog({
  rfp,
  open,
  onOpenChange,
  onSave,
  onDelete,
}: {
  rfp: Rfp | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (draft: RfpDraft, existing: Rfp | null) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const { can } = useAuth()
  const [draft, setDraft] = useState<RfpDraft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [conceptOpen, setConceptOpen] = useState(false)

  useEffect(() => {
    if (open) setDraft(rfp ? toDraft(rfp) : EMPTY)
  }, [open, rfp])

  function set<K extends keyof RfpDraft>(key: K, value: RfpDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function handleSave() {
    if (!draft.title.trim()) {
      toast.error('Title is required')
      return
    }
    if (draft.link.trim() && !safeExternalUrl(draft.link.trim())) {
      toast.error('The source link must be a valid HTTP or HTTPS address without embedded credentials')
      return
    }
    setBusy(true)
    try {
      await onSave({ ...draft, title: draft.title.trim() }, rfp)
      onOpenChange(false)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!rfp) return
    setBusy(true)
    try {
      await onDelete(rfp.id)
      onOpenChange(false)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const org = draft.org.trim()
  // An RFP is an existing brief, so the draft is a proposal responding to it —
  // not a concept note introducing an idea.
  const conceptContext: ConceptNoteContext | null = org
    ? {
        kind: 'proposal',
        org,
        segment: draft.segment,
        notes: draft.notes,
        rfpTitle: draft.title.trim(),
        deadline: draft.deadline,
      }
    : null

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="font-display">
              {rfp ? 'Edit RFP' : 'Add RFP'}
            </DialogTitle>
          </DialogHeader>

          <div>
            <Field label="Title" htmlFor="rfp-title">
              <Input
                id="rfp-title"
                value={draft.title}
                onChange={(event) => set('title', event.target.value)}
                className="w-full"
              />
            </Field>

            <FieldRow>
              <Field label="Organization" htmlFor="rfp-org">
                <Input
                  id="rfp-org"
                  value={draft.org}
                  onChange={(event) => set('org', event.target.value)}
                  className="w-full"
                />
              </Field>
              <SelectField
                label="Segment"
                value={draft.segment}
                options={SEGMENTS}
                onChange={(value) => set('segment', value)}
              />
            </FieldRow>

            <FieldRow>
              <Field label="Submission deadline" htmlFor="rfp-deadline">
                <Input
                  id="rfp-deadline"
                  type="date"
                  value={draft.deadline}
                  onChange={(event) => set('deadline', event.target.value)}
                  className="w-full"
                />
              </Field>
              <Field label="Est. value (KES)" htmlFor="rfp-value">
                <Input
                  id="rfp-value"
                  type="number"
                  min={0}
                  value={draft.value ?? ''}
                  onChange={(event) =>
                    set(
                      'value',
                      event.target.value === '' ? null : Number(event.target.value),
                    )
                  }
                  className="w-full"
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <SelectField
                label="Status"
                value={draft.status}
                options={RFP_STATUSES}
                onChange={(value) => set('status', value)}
              />
              <Field label="Link / portal" htmlFor="rfp-link">
                <Input
                  id="rfp-link"
                  value={draft.link}
                  onChange={(event) => set('link', event.target.value)}
                  className="w-full"
                />
              </Field>
            </FieldRow>

            <Field label="Notes" htmlFor="rfp-notes">
              <Textarea
                id="rfp-notes"
                value={draft.notes}
                onChange={(event) => set('notes', event.target.value)}
                className="min-h-[60px] w-full"
              />
            </Field>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {rfp && can.remove && (
              <Button
                variant="destructive"
                onClick={() => void handleDelete()}
                disabled={busy}
                className="mr-auto"
              >
                Delete
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setConceptOpen(true)}
              disabled={!conceptContext}
              title={
                conceptContext
                  ? undefined
                  : 'Add an organization name first'
              }
            >
              {DRAFT_LABELS.proposal.action}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={busy}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConceptNoteDialog
        context={conceptContext}
        open={conceptOpen}
        onOpenChange={setConceptOpen}
      />
    </>
  )
}
