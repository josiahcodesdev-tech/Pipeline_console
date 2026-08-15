import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { DownloadIcon, FileTextIcon, TrashIcon, UserRoundIcon } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { consultantFileUrl } from '@/data/consultants'
import type { Consultant } from '@/domain/types'

function formatBytes(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The photo, shown from a signed URL.
 *
 * The bucket is private, so there is no permanent address to put in `src` —
 * one has to be minted per view and expires shortly after. That is deliberate:
 * these are named individuals' photographs, and a URL that works forever for
 * anyone who has ever seen it is not a private file.
 */
function Photo({ path, name }: { path: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!path) {
      setUrl(null)
      return
    }
    let live = true
    void consultantFileUrl(path)
      .then((signed) => {
        if (live) setUrl(signed)
      })
      // A photo that will not load is a missing photo, not an error worth
      // interrupting someone over — the placeholder below says as much.
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [path])

  if (!url) {
    return (
      <div className="grid size-20 place-items-center rounded-xl border border-border bg-surface-2 text-faint">
        <UserRoundIcon className="size-7" aria-hidden />
      </div>
    )
  }

  return (
    <img
      src={url}
      alt={name ? `${name}` : 'Consultant photo'}
      className="size-20 rounded-xl border border-border object-cover"
    />
  )
}

/**
 * Photo and CV for one consultant.
 *
 * Both need a saved row to attach to, so this only appears once the consultant
 * exists — a file has to belong to something, and the storage path is built
 * from the row's id.
 *
 * The CV matters more than it looks: nearly every tender asks for one as an
 * annex, and the bid-readiness notes list it as something the team must supply.
 * Holding it here means the answer is already on file rather than a scramble
 * the day before the deadline.
 */
export function ConsultantFiles({
  consultant,
  onSet,
}: {
  consultant: Consultant
  onSet: (consultant: Consultant, kind: 'photo' | 'cv', file: File | null) => Promise<void>
}) {
  const photoInput = useRef<HTMLInputElement>(null)
  const cvInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'photo' | 'cv' | null>(null)

  async function attach(kind: 'photo' | 'cv', file: File | undefined) {
    if (!file) return
    setBusy(kind)
    try {
      await onSet(consultant, kind, file)
    } finally {
      setBusy(null)
      // Cleared so choosing the same file twice still fires a change event —
      // otherwise re-uploading a corrected version of the same filename does
      // nothing and looks broken.
      if (kind === 'photo' && photoInput.current) photoInput.current.value = ''
      if (kind === 'cv' && cvInput.current) cvInput.current.value = ''
    }
  }

  async function open() {
    try {
      window.open(await consultantFileUrl(consultant.cvPath), '_blank', 'noopener')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-5 border-t border-border-soft pt-4">
      <div className="flex items-start gap-3">
        <Photo path={consultant.photoPath} name={consultant.name} />
        <div className="flex flex-col gap-1.5">
          <div className="eyebrow text-muted-foreground">Photo</div>
          <input
            ref={photoInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(event) => void attach('photo', event.target.files?.[0])}
            disabled={busy !== null}
            className="block max-w-[210px] text-[11px] text-muted-foreground file:mr-2 file:cursor-pointer file:rounded-lg file:border file:border-border file:bg-card file:px-2.5 file:py-1 file:text-[11px] file:text-foreground"
          />
          <p className="text-[10.5px] text-faint">
            {busy === 'photo' ? 'Uploading…' : 'JPG, PNG, WebP or GIF · up to 4 MB'}
          </p>
          {consultant.photoPath && (
            <Button
              variant="ghost"
              size="xs"
              className="self-start"
              onClick={() => void onSet(consultant, 'photo', null)}
            >
              <TrashIcon />
              Remove photo
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
        <div className="eyebrow text-muted-foreground">CV</div>
        {consultant.cvPath ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-success-soft px-2 py-1 text-[11.5px] font-medium text-success">
              <FileTextIcon className="size-3.5" />
              {consultant.cvFileName || 'CV attached'}
            </span>
            <span className="text-[11px] text-faint">{formatBytes(consultant.cvSize)}</span>
            <Button variant="ghost" size="xs" onClick={() => void open()}>
              <DownloadIcon />
              Open
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void onSet(consultant, 'cv', null)}
            >
              <TrashIcon />
              Remove
            </Button>
          </div>
        ) : (
          <>
            <input
              ref={cvInput}
              type="file"
              accept=".pdf,.doc,.docx,.odt,.rtf,application/pdf"
              onChange={(event) => void attach('cv', event.target.files?.[0])}
              disabled={busy !== null}
              className="block w-full text-[11px] text-muted-foreground file:mr-2 file:cursor-pointer file:rounded-lg file:border file:border-border file:bg-card file:px-2.5 file:py-1 file:text-[11px] file:text-foreground"
            />
            <p className="text-[10.5px] text-faint">
              {busy === 'cv'
                ? 'Uploading…'
                : 'PDF or Word · up to 15 MB. Most tenders ask for this as an annex.'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
