import {
  ClipboardListIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MessageSquareIcon,
  SettingsIcon,
  TargetIcon,
  TrendingUpIcon,
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
  { id: 'settings', label: 'Guidance', icon: SettingsIcon },
] as const satisfies readonly {
  id: string
  label: string
  icon: LucideIcon
}[]

export type ViewId = (typeof NAV_ITEMS)[number]['id']

/**
 * What the sidebar actually shows. `NAV_ITEMS` stays complete so `ViewId` keeps
 * covering every view even while one is hidden.
 */
export const VISIBLE_NAV_ITEMS = NAV_ITEMS.filter(
  (item) => item.id !== 'settings' || PROPOSAL_DRAFTING,
)

export function isViewId(value: string): value is ViewId {
  return NAV_ITEMS.some((item) => item.id === value)
}
