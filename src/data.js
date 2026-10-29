import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config.js'

export const supa = isConfigured() ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

// ── Auth ──
export const getSession = async () => (await supa.auth.getSession()).data.session
export const onAuthChange = cb => supa.auth.onAuthStateChange((_e, session) => cb(session))
export async function signIn(email, password) {
  const { error } = await supa.auth.signInWithPassword({ email, password })
  if (error) throw error
}
export const signOut = () => supa.auth.signOut()

export async function isMember(userId) {
  const { data, error } = await supa.from('worklog_members').select('user_id').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return !!data
}

const must = ({ data, error }) => { if (error) throw error; return data }
async function readAll(build) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const data = must(await build().range(from, from + 999))
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}

// ── Load ──
export async function fetchAll() {
  const [materials, evaluations, events, runs] = await Promise.all([
    readAll(() => supa.from('rm_materials').select('*').is('removed_at', null).order('folder')),
    readAll(() => supa.from('rm_evaluations').select('*').is('removed_at', null).order('folder')),
    readAll(() => supa.from('rm_events').select('*').order('event_date').order('created_at')),
    supa.from('rm_scan_runs').select('*').order('started_at', { ascending: false }).limit(1).then(must),
  ])
  return { materials, evaluations, events, lastRun: runs[0] ?? null }
}

// ── Writes (app-owned columns only) ──
const EVAL_FIELDS = ['candidate_name', 'stamp', 'supplier', 'manufacturer', 'avl_listed', 'item_code', 'next_action', 'notes']
const pick = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k)))

export const updateEvaluation = async (id, patch) =>
  must(await supa.from('rm_evaluations').update(pick(patch, EVAL_FIELDS)).eq('id', id).select('*').single())

export const updateMaterial = async (id, patch) =>
  must(await supa.from('rm_materials').update(pick(patch, ['kind', 'products', 'notes'])).eq('id', id).select('*').single())

export const addEvent = async ev =>
  must(await supa.from('rm_events').insert({ ...pick(ev, ['material_id', 'evaluation_id', 'kind', 'event_date', 'what', 'party', 'note']), source: 'app' }).select('*').single())

export const updateEvent = async (id, patch) =>
  must(await supa.from('rm_events').update(pick(patch, ['event_date', 'what', 'party', 'note', 'closed_on'])).eq('id', id).select('*').single())

export async function deleteEvent(id) {
  must(await supa.from('rm_events').delete().eq('id', id).neq('source', 'scan'))
}

// Desktop only: scan the folder in the Electron main process as this user.
export async function runScan(root) {
  const session = await getSession()
  return window.electronAPI.scan({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY, token: session.access_token, root })
}
