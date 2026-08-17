import { cn } from '@/shared/utils'

/**
 * The Icons8 Fluency icons used on the dashboard.
 *
 * Served from `public/icons` rather than hotlinked to img.icons8.com. Same
 * licence either way, but a console used daily should not make eight
 * third-party requests on every page load, and the dashboard should still
 * render if icons8 is slow, blocked by a corporate network, or changes a URL.
 *
 * Licence: covered by a licence that does not require on-page attribution, so
 * there is no longer a link in the dashboard footer. The free Icons8 tier does
 * require one — if these are ever swapped back to it, the link has to come
 * back with them.
 */
const ICONS = {
  qualified: 'qualified',
  discipline: 'discipline',
  rfps: 'rfps',
  logged: 'logged',
  tasks: 'tasks',
  deadlines: 'deadlines',
  pipeline: 'goal',
  team: 'team',
} as const

export type SubjectName = keyof typeof ICONS

/**
 * A subject mark — what a figure is *about*, as opposed to how it is doing.
 *
 * Deliberately decorative: `alt` is empty and it is hidden from assistive
 * technology, because the label beside it already says what the card counts.
 * An icon that repeats its own label is noise to a screen reader.
 */
export function SubjectIcon({
  name,
  className,
}: {
  name: SubjectName
  className?: string
}) {
  return (
    <img
      src={`/icons/mono/${ICONS[name]}.png`}
      alt=""
      aria-hidden
      width={96}
      height={96}
      // Native lazy loading would delay marks that are above the fold on every
      // page load; these are 0.5–5 KB each and wanted immediately.
      loading="eager"
      decoding="async"
      className={cn('size-5 shrink-0 object-contain', className)}
    />
  )
}
