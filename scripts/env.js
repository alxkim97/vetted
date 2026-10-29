// Service-key client for the scripts that run with nobody signed in
// (scheduled scan, rm-log). Reads .env.local next to package.json.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export function serviceClient() {
  const file = join(ROOT, '.env.local')
  const env = Object.fromEntries((existsSync(file) ? readFileSync(file, 'utf8') : '')
    .split(/\r?\n/).map(l => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^"|"$/g, '')]))
  const url = process.env.SUPABASE_URL || env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error(`Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in ${file} (see supabase/SETUP.md)`); process.exit(1) }
  return { supa: createClient(url, key, { auth: { persistSession: false } }), env }
}
