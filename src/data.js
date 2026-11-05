import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config.js'
import { todayIso } from './model.js'

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
  const [materials, evaluations, events, runs, products, evidence, files] = await Promise.all([
    readAll(() => supa.from('rm_materials').select('*').is('removed_at', null).order('folder')),
    readAll(() => supa.from('rm_evaluations').select('*').is('removed_at', null).order('folder')),
    readAll(() => supa.from('rm_events').select('*').order('event_date').order('created_at')),
    supa.from('rm_scan_runs').select('*').order('started_at', { ascending: false }).limit(1).then(must),
    // project groups and BOMs; empty until the v0.4.0 SQL has been run
    readAll(() => supa.from('rm_products').select('*').order('name')).catch(() => []),
    // request evidence images; empty until the v0.6.0 SQL has been run
    readAll(() => supa.from('rm_evidence').select('*').order('created_at')).catch(() => []),
    // documents in each candidate's Document folders; empty until the v0.7.0 SQL
    readAll(() => supa.from('rm_files').select('*').order('doc_date')).catch(() => []),
  ])
  return { materials, evaluations, events, products, evidence, files, lastRun: runs[0] ?? null }
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

// A stage change as a dated timeline entry (v0.7): what = stage key, note = new value.
export const addStageEvent = async (r, key, value) =>
  must(await supa.from('rm_events').insert({ material_id: r.material.id, evaluation_id: r.id, kind: 'stage', event_date: todayIso(), what: key, note: value == null ? null : String(value), source: 'app' }).select('*').single())

// Undo puts back exactly what was deleted, same ids.
export const restoreEvent = async row => must(await supa.from('rm_events').insert(row).select('*').single())
export const restoreEvidence = async rows => rows.length ? must(await supa.from('rm_evidence').insert(rows).select('*')) : []
export const removeEvidenceRows = async ids => { if (ids.length) must(await supa.from('rm_evidence').delete().in('id', ids)) }

export const updateEvent = async (id, patch) =>
  must(await supa.from('rm_events').update(pick(patch, ['event_date', 'what', 'party', 'note', 'closed_on'])).eq('id', id).select('*').single())

// Image files stay in the bucket until the delete can no longer be undone
// (see undo.js purge); only the rows go now.
export async function deleteEvent(id) {
  must(await supa.from('rm_events').delete().eq('id', id).neq('source', 'scan'))
}
export const purgeFiles = async paths => { if (paths.length) await supa.storage.from(BUCKET).remove(paths) }

// ── Request evidence images (private bucket, members only) ──
const BUCKET = 'rm-evidence'
const extOf = f => (f.name?.match(/\.([a-z0-9]{1,5})$/i)?.[1] || f.type.split('/')[1] || 'png').toLowerCase()
export async function addEvidence(ev, file) {
  const path = `${ev.evaluation_id || ev.material_id}/${ev.id}/${crypto.randomUUID()}.${extOf(file)}`
  must(await supa.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'image/png' }))
  return must(await supa.from('rm_evidence').insert({ event_id: ev.id, path, file_name: file.name || null }).select('*').single())
}
export async function deleteEvidence(row) {
  must(await supa.from('rm_evidence').delete().eq('id', row.id))
}
// Short-lived links for the thumbnails; { path: url }. A view link gets them
// with its data instead (setViewUrls).
let viewUrls = null
export const setViewUrls = map => { viewUrls = map }
export async function evidenceUrls(paths) {
  if (!paths.length) return {}
  if (viewUrls) return Object.fromEntries(paths.filter(p => viewUrls[p]).map(p => [p, viewUrls[p]]))
  const data = must(await supa.storage.from(BUCKET).createSignedUrls(paths, 3600))
  return Object.fromEntries(data.filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]))
}

// ── Stored documents (Selection Form + CoA scans uploaded by the scan) ──
export async function fileUrl(path) {
  if (viewUrls) return viewUrls[`files/${path}`] ?? null
  return must(await supa.storage.from('rm-files').createSignedUrl(path, 3600)).signedUrl
}

// ── Manager view link ──
export const fetchShares = async () => must(await supa.from('rm_shares').select('*').is('revoked_at', null).order('created_at'))
export async function createShare() {
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return must(await supa.from('rm_shares').insert({ token, label: 'Managers' }).select('*').single())
}
export const revokeShare = async token => must(await supa.from('rm_shares').update({ revoked_at: new Date().toISOString() }).eq('token', token))

// The view link reads through the server (api/view.js), never with the anon key.
async function viewGet(token, extra = '') {
  const res = await fetch(`/api/view?t=${encodeURIComponent(token)}${extra}`)
  if (res.status === 404 || res.status === 403) throw Object.assign(new Error('This view link has been turned off. Ask Alex for a new one.'), { revoked: true })
  if (!res.ok) throw new Error(`Couldn't load (${res.status})`)
  return res.json()
}
export async function fetchView(token) {
  const d = await viewGet(token)
  setViewUrls(d.urls || {})
  return d
}
export const fetchViewDoc = (token, id) => viewGet(token, `&doc=${encodeURIComponent(id)}`)

// Desktop only: scan the folder in the Electron main process as this user.
export async function runScan(root, upload = false) {
  const session = await getSession()
  return window.electronAPI.scan({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY, token: session.access_token, root, upload })
}
