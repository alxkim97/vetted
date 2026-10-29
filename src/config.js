// The worklog Supabase project — Vetted only adds rm_* tables to it.
// The publishable key is public by design; every rm_* table is locked to
// worklog_members by RLS (supabase/SETUP.md).
export const SUPABASE_URL = 'https://uhlbrxyvhfmfeakckzlu.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_ddVyqs4A4o9j2WsUkDHeZQ_6UskvhMg'

export const isConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY)
