import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/data/database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * True when the app has been pointed at a Supabase project. When false the UI
 * shows setup instructions instead of a login form, which is a far better
 * failure mode than a stack of network errors.
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured) {
  console.warn(
    '[pipeline-console] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. ' +
      'Copy .env.example to .env.local and fill them in.',
  )
}

/**
 * Created even when unconfigured (with harmless placeholders) so that modules
 * can import it at the top level without guarding every reference. Nothing
 * calls it until `isSupabaseConfigured` is true.
 */
export const supabase: SupabaseClient<Database> = createClient<Database>(
  url || 'http://localhost:54321',
  anonKey || 'public-anon-key-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
