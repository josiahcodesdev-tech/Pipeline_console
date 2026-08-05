import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import type { MemberRole, Profile } from '@/lib/types'
import { isMemberRole } from '@/lib/types'

/**
 * What the signed-in member is allowed to do.
 *
 * Every one of these is enforced again by a row-level security policy in the
 * database, and that is where the actual protection lives. These flags decide
 * what to *render* — a button nobody can use is worse than no button, but a
 * hidden button is not a permission check.
 */
export interface Permissions {
  /** Delete records. Admins and the super user only. */
  remove: boolean
  /** Trigger the opportunity sync by hand. The 5 AM run is unaffected. */
  sync: boolean
  /** Add members and set their access. Super user only. */
  manageMembers: boolean
  /** See other members' pipelines rather than only their own. */
  seeEveryone: boolean
}

interface AuthValue {
  session: Session | null
  /** The member's own row. Null while loading, or if the account has none. */
  profile: Profile | null
  role: MemberRole
  can: Permissions
  /**
   * True when the account exists but has been switched off. Distinct from
   * signed-out: the credentials are valid, the access is not.
   */
  suspended: boolean
  /** True until the initial session lookup settles — avoids a login flash. */
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

/**
 * The permissions of someone whose profile has not loaded, or who has none.
 *
 * Deliberately the least privileged set rather than a neutral one: a race on
 * page load should show a member too few buttons for a moment, never too many.
 */
const NO_PERMISSIONS: Permissions = {
  remove: false,
  sync: false,
  manageMembers: false,
  seeEveryone: false,
}

function permissionsFor(role: MemberRole, active: boolean): Permissions {
  if (!active) return NO_PERMISSIONS
  const admin = role === 'super_user' || role === 'admin'
  return {
    remove: admin,
    sync: admin,
    manageMembers: role === 'super_user',
    seeEveryone: admin,
  }
}

interface ProfileRow {
  id: string
  email: string | null
  full_name: string | null
  role: string | null
  active: boolean | null
  created_at: string | null
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email ?? '',
    fullName: row.full_name ?? '',
    role: isMemberRole(row.role) ? row.role : 'user',
    active: row.active ?? true,
    createdAt: row.created_at ?? '',
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null)
      return
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, active, created_at')
      .eq('id', userId)
      .maybeSingle()

    // A failure here must not read as "no permissions forever" — but it also
    // must not read as full access. Leaving the profile null keeps the console
    // at the least-privileged default until the next load succeeds.
    if (error) {
      console.error('Could not load member profile', error)
      setProfile(null)
      return
    }
    setProfile(data ? toProfile(data as ProfileRow) : null)
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return

    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await loadProfile(data.session?.user?.id)
      if (active) setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, next) => {
        setSession(next)
        // Not awaited: the listener is synchronous and the profile arriving a
        // moment later is fine, because the default until it does is no access.
        void loadProfile(next?.user?.id)
        setLoading(false)
      },
    )

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw new Error(error.message)
    setProfile(null)
  }, [])

  const refreshProfile = useCallback(async () => {
    await loadProfile(session?.user?.id)
  }, [loadProfile, session])

  const value = useMemo<AuthValue>(() => {
    const role: MemberRole = profile?.role ?? 'user'
    const suspended = profile !== null && !profile.active
    return {
      session,
      profile,
      role,
      can: profile ? permissionsFor(role, profile.active) : NO_PERMISSIONS,
      suspended,
      loading,
      signIn,
      signOut,
      refreshProfile,
    }
  }, [session, profile, loading, signIn, signOut, refreshProfile])

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthValue {
  const value = use(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
