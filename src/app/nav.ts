import {
  ClipboardListIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MessageSquareIcon,
  MonitorCogIcon,
  SettingsIcon,
  TargetIcon,
  TrendingUpIcon,
  UserRoundIcon,
  ShieldIcon,
  HistoryIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import { PROPOSAL_DRAFTING } from './features'

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboardIcon },
  { id: 'leads', label: 'Leads', icon: UsersIcon },
  { id: 'rfps', label: 'RFPs', icon: ClipboardListIcon },
  { id: 'digital-solutions', label: 'Digital Solutions', icon: MonitorCogIcon },
  { id: 'pipeline', label: 'Proposals', icon: TargetIcon },
  { id: 'activity', label: 'Activity', icon: MessageSquareIcon },
  { id: 'tasks', label: 'Tasks', icon: ListChecksIcon },
  { id: 'progress', label: 'Progress', icon: TrendingUpIcon },
  { id: 'report', label: 'Reports', icon: FileTextIcon },
  { id: 'records', label: 'Records', icon: HistoryIcon },
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
 * Views only the super user has any use for.
 *
 * Members was once shown to admins too, on the argument that the firm-wide
 * figures on it are oversight rather than administration. It is now super-user
 * only: an admin who cannot add, remove, reassign or reset anyone was reading a
 * page of controls that all refused them. The one thing they actually needed
 * from it — who has taken which tender — is a column on Proposals instead.
 *
 * Records joined it for a different and stronger reason. That page is the audit
 * trail: who changed what, when, across every member's leads, tenders,
 * proposals and activity. It is the record of what an administrator did, so an
 * administrator who can read it is one of the handful of people it is about,
 * auditing themselves. Oversight is the wrong boundary for that one page.
 *
 * The server agrees, which is the half that matters. Migration 0043 narrows
 * `audit_log_select` to `is_super_user()`, so an admin issuing the query by
 * hand gets nothing back. This list only spares them a page that would be
 * empty.
 */
const SUPER_USER_ONLY: readonly ViewId[] = ['members', 'records']

/**
 * Views for both oversight roles. Empty today.
 *
 * Kept rather than deleted along with its parameter: "admin and super user, but
 * not an ordinary member" is a real category that Records occupied until the
 * audit trail made it the wrong one, and the next view in it should not have to
 * reintroduce the machinery.
 */
const OVERSIGHT_ONLY: readonly ViewId[] = []

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
export function navItemsFor(canManageMembers: boolean, canSeeEveryone: boolean) {
  return FLAGGED_NAV_ITEMS.filter(
    (item) =>
      (!SUPER_USER_ONLY.includes(item.id) || canManageMembers) &&
      (!OVERSIGHT_ONLY.includes(item.id) || canSeeEveryone),
  )
}

/** Whether this member may open a view at all, for the router's fallback. */
export function canOpenView(
  id: ViewId,
  canManageMembers: boolean,
  canSeeEveryone: boolean,
): boolean {
  return (
    (!SUPER_USER_ONLY.includes(id) || canManageMembers) &&
    (!OVERSIGHT_ONLY.includes(id) || canSeeEveryone)
  )
}

export function isViewId(value: string): value is ViewId {
  return NAV_ITEMS.some((item) => item.id === value)
}
