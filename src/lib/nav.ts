import {
  ClipboardListIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MessageSquareIcon,
  SettingsIcon,
  TargetIcon,
  TrendingUpIcon,
  UserRoundIcon,
  ShieldIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import { PROPOSAL_DRAFTING } from './features'

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboardIcon },
  { id: 'leads', label: 'Leads', icon: UsersIcon },
  { id: 'rfps', label: 'RFPs', icon: ClipboardListIcon },
  { id: 'pipeline', label: 'Proposals', icon: TargetIcon },
  { id: 'activity', label: 'Activity', icon: MessageSquareIcon },
  { id: 'tasks', label: 'Tasks', icon: ListChecksIcon },
  { id: 'progress', label: 'Progress', icon: TrendingUpIcon },
  { id: 'report', label: 'Reports', icon: FileTextIcon },
  { id: 'consultants', label: 'Consultants', icon: UserRoundIcon },
  { id: 'members', label: 'Members', icon: ShieldIcon },
  { id: 'settings', label: 'Guidance', icon: SettingsIcon },
] as const satisfies readonly {
  id: string
  label: string
  icon: LucideIcon
}[]

export type ViewId = (typeof NAV_ITEMS)[number]['id']

/**
 * Views a standard user has no use for.
 *
 * Members is shown to admins as well as the super user: the page carries the
 * firm-wide figures and who is bidding what, which is oversight rather than
 * administration. Only the add-a-member form and the access controls within it
 * are super-user-only, and those gate themselves.
 */
const OVERSIGHT_ONLY: readonly ViewId[] = ['members']

/**
 * What the sidebar actually shows. `NAV_ITEMS` stays complete so `ViewId` keeps
 * covering every view even while one is hidden.
 *
 * Consultants sits behind the drafting flag with Guidance: the roster exists to
 * staff proposals, so with drafting off it is a contact list with nothing
 * reading it.
 */
const DRAFTING_ONLY: readonly ViewId[] = ['settings', 'consultants']

const FLAGGED_NAV_ITEMS = NAV_ITEMS.filter(
  (item) => !DRAFTING_ONLY.includes(item.id) || PROPOSAL_DRAFTING,
)

/**
 * What this member should see in the sidebar.
 *
 * Hiding Members from everyone else is tidiness, not security — the page reads
 * `profiles`, which every member may read anyway, and every action on it is
 * refused by the server for anyone but the super user.
 */
export function navItemsFor(canSeeEveryone: boolean) {
  return FLAGGED_NAV_ITEMS.filter(
    (item) => !OVERSIGHT_ONLY.includes(item.id) || canSeeEveryone,
  )
}

export function isViewId(value: string): value is ViewId {
  return NAV_ITEMS.some((item) => item.id === value)
}
