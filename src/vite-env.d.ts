/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Overrides the CareerCraft opportunities feed URL. Optional. */
  readonly VITE_OPPORTUNITIES_API_URL?: string
  /** Only needed if OPPORTUNITIES_API_KEY is set on the CareerCraft side. */
  readonly VITE_OPPORTUNITIES_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
