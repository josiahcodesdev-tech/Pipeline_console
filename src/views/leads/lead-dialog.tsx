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
import { Field, FieldRow, SelectField } from '@/components/field'
import { ConceptNoteDialog } from '@/components/concept-note-dialog'
import type { LeadDraft } from '@/lib/db'
import { LEAD_STATUSES, SEGMENTS, type Lead } from '@/lib/types'
import { DRAFT_LABELS, type ConceptNoteContext } from '@/lib/concept-note'

const EMPTY: LeadDraft = {
  org: '',
  segment: 'Government',
  country: '',
  contactName: '',
  contactRole: '',
  email: '',
  phone: '',
  status: 'New',
  nextActionDate: '',
  source: '',
  notes: '',
}

function toDraft(lead: Lead): LeadDraft {
  const { id: _id, createdOn: _createdOn, statusUpdatedOn: _statusUpdatedOn, ...draft } = lead
  return draft
}

export function LeadDialog({
  lead,
  open,
  onOpenChange,
  onSave,
  onDelete,
}: {
  /** `null` opens the dialog in create mode. */
  lead: Lead | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (draft: LeadDraft, existing: Lead | null) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [draft, setDraft] = useState<LeadDraft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [conceptOpen, setConceptOpen] = useState(false)

  // Reset the form each time the dialog opens so a cancelled edit never leaks
  // into the next one.
  useEffect(() => {
    if (open) setDraft(lead ? toDraft(lead) : EMPTY)
  }, [open, lead])

  function set<K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function handleSave() {
    if (!draft.org.trim()) {
      toast.error('Organization name is required')
      return
    }
    setBusy(true)
    try {
      await onSave({ ...draft, org: draft.org.trim() }, lead)
      onOpenChange(false)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!lead) return
    setBusy(true)
    try {
      await onDelete(lead.id)
      onOpenChange(false)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  // A lead is unsolicited outreach, so it gets a concept note rather than a
  // proposal — there is no brief to respond to yet.
  const conceptContext: ConceptNoteContext | null = draft.org.trim()
    ? {
        kind: 'concept-note',
        org: draft.org.trim(),
        segment: draft.segment,
        country: draft.country,
        contactRole: draft.contactRole,
        notes: draft.notes,
      }
    : null

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="font-display">
              {lead ? 'Edit lead' : 'Add lead'}
            </DialogTitle>
          </DialogHeader>

          <div>
            <Field label="Organization name" htmlFor="lead-org">
              <Input
                id="lead-org"
                value={draft.org}
                onChange={(event) => set('org', event.target.value)}
                className="w-full"
              />
            </Field>

            <FieldRow>
              <SelectField
                label="Segment"
                value={draft.segment}
                options={SEGMENTS}
                onChange={(value) => set('segment', value)}
              />
              <Field label="Country" htmlFor="lead-country">
                <Input
                  id="lead-country"
                  value={draft.country}
                  onChange={(event) => set('country', event.target.value)}
                  className="w-full"
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Contact name" htmlFor="lead-contact">
                <Input
                  id="lead-contact"
                  value={draft.contactName}
                  onChange={(event) => set('contactName', event.target.value)}
                  className="w-full"
                />
              </Field>
              <Field label="Contact role" htmlFor="lead-role">
                <Input
                  id="lead-role"
                  value={draft.contactRole}
                  onChange={(event) => set('contactRole', event.target.value)}
                  className="w-full"
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Email" htmlFor="lead-email">
                <Input
                  id="lead-email"
                  type="email"
                  value={draft.email}
                  onChange={(event) => set('email', event.target.value)}
                  className="w-full"
                />
              </Field>
              <Field label="Phone" htmlFor="lead-phone">
                <Input
                  id="lead-phone"
                  value={draft.phone}
                  onChange={(event) => set('phone', event.target.value)}
                  className="w-full"
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <SelectField
                label="Status"
                value={draft.status}
                options={LEAD_STATUSES}
                onChange={(value) => set('status', value)}
              />
              <Field label="Next action date" htmlFor="lead-next">
                <Input
                  id="lead-next"
                  type="date"
                  value={draft.nextActionDate}
                  onChange={(event) => set('nextActionDate', event.target.value)}
                  className="w-full"
                />
              </Field>
            </FieldRow>

            <Field label="Source" htmlFor="lead-source">
              <Input
                id="lead-source"
                placeholder="e.g. LinkedIn, referral, tender portal"
                value={draft.source}
                onChange={(event) => set('source', event.target.value)}
                className="w-full"
              />
            </Field>

            <Field label="Notes / next action" htmlFor="lead-notes">
              <Textarea
                id="lead-notes"
                value={draft.notes}
                onChange={(event) => set('notes', event.target.value)}
                className="min-h-[60px] w-full"
              />
            </Field>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {lead && (
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
              title={conceptContext ? undefined : 'Add an organization name first'}
            >
              {DRAFT_LABELS['concept-note'].action}
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
