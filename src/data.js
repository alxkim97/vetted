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
  const [materials, evaluations, events, runs, products, evidence] = await Promise.all([
    readAll(() => supa.from('rm_materials').select('*').is('removed_at', null).order('folder')),
    readAll(() => supa.from('rm_evaluations').select('*').is('removed_at', null).order('folder')),
    readAll(() => supa.from('rm_events').select('*').order('event_date').order('created_at')),
    supa.from('rm_scan_runs').select('*').order('started_at', { ascending: false }).limit(1).then(must),
    // project groups and BOMs; empty until the v0.4.0 SQL has been run
    readAll(() => supa.from('rm_products').select('*').order('name')).catch(() => []),
    // request evidence images; empty until the v0.6.0 SQL has been run
    readAll(() => supa.from('rm_evidence').select('*').order('created_at')).catch(() => []),
  ])
  return { materials, evaluations, events, products, evidence, lastRun: runs[0] ?? null }
}

// ── Writes (app-owned columns only) ──
const EVAL_FIELDS = ['candidate_name', 'coa', 'docs', 'qc', 'outcome', 'supplier', 'manufacturer', 'avl_listed', 'item_code', 'next_action', 'notes']
const pick = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k)))

// The comparison file for one evaluation (null if none scanned yet).
export async function fetchDoc(evaluationId) {
  return must(await supa.from('rm_eval_docs').select('body,updated_at').eq('evaluation_id', evaluationId).maybeSingle())
}
export async function fetchGlossary() {
  return Object.fromEntries((await readAll(() => supa.from('rm_glossary').select('thai,english'))).map(r => [r.thai, r.english]))
}

export const updateEvaluation = async (id, patch) =>
  must(await supa.from('rm_evaluations').update(pick(patch, EVAL_FIELDS)).eq('id', id).select('*').single())

export const updateMaterial = async (id, patch) =>
  must(await supa.from('rm_materials').update(pick(patch, ['kind', 'products', 'notes'])).eq('id', id).select('*').single())

export const addEvent = async ev =>
  must(await supa.from('rm_events').insert({ ...pick(ev, ['material_id', 'evaluation_id', 'kind', 'event_date', 'what', 'party', 'note', ...(ev.topic ? ['topic'] : [])]), source: 'app' }).select('*').single())

export const updateEvent = async (id, patch) =>
  must(await supa.from('rm_events').update(pick(patch, ['event_date', 'what', 'party', 'note', 'closed_on'])).eq('id', id).select('*').single())

export async function deleteEvent(id, evidence = []) {
  if (evidence.length) await supa.storage.from(BUCKET).remove(evidence.map(x => x.path))
  must(await supa.from('rm_events').delete().eq('id', id).neq('source', 'scan'))
}

// ── Request evidence images (private bucket, members only) ──
const BUCKET = 'rm-evidence'
const extOf = f => (f.name?.match(/\.([a-z0-9]{1,5})$/i)?.[1] || f.type.split('/')[1] || 'png').toLowerCase()
export async function addEvidence(ev, file) {
  const path = `${ev.evaluation_id || ev.material_id}/${ev.id}/${crypto.randomUUID()}.${extOf(file)}`
  must(await supa.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'image/png' }))
  return must(await supa.from('rm_evidence').insert({ event_id: ev.id, path, file_name: file.name || null }).select('*').single())
}
export async function deleteEvidence(row) {
  await supa.storage.from(BUCKET).remove([row.path])
  must(await supa.from('rm_evidence').delete().eq('id', row.id))
}
// Short-lived links for the thumbnails; { path: url }.
export async function evidenceUrls(paths) {
  if (!paths.length) return {}
  const data = must(await supa.storage.from(BUCKET).createSignedUrls(paths, 3600))
  return Object.fromEntries(data.filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]))
}

// Desktop only: scan the folder in the Electron main process as this user.
export async function runScan(root) {
  const session = await getSession()
  return window.electronAPI.scan({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY, token: session.access_token, root })
}
