// `npm run demo`: same exports as data.js, backed by src/demo-scan.json in
// memory (build it with `npm run demo:data`). Nothing is saved.
import demo from './demo-scan.json'

const db = structuredClone(demo)
const uid = () => crypto.randomUUID()
const upd = (list, id, patch) => { const r = list.find(x => x.id === id); Object.assign(r, patch); return structuredClone(r) }

export const supa = null
export const getSession = async () => ({ user: { id: 'demo', email: 'demo' }, access_token: 'demo' })
export const onAuthChange = () => {}
export const signIn = async () => {}
export const signOut = async () => location.reload()
export const isMember = async () => true
export const fetchAll = async () => { const { docs, glossary, ...rest } = db; return structuredClone(rest) }
export const fetchDoc = async id => db.docs?.[id] ? { body: db.docs[id], updated_at: db.lastRun.finished_at } : null
export const fetchGlossary = async () => db.glossary || {}
export const updateEvaluation = async (id, patch) => upd(db.evaluations, id, patch)
export const updateMaterial = async (id, patch) => upd(db.materials, id, patch)
export const updateEvent = async (id, patch) => upd(db.events, id, patch)
export const addEvent = async ev => { const r = { id: uid(), source: 'app', closed_on: null, created_at: new Date().toISOString(), ...ev }; db.events.push(r); return structuredClone(r) }
export const deleteEvent = async id => { db.events = db.events.filter(x => x.id !== id); db.evidence = (db.evidence || []).filter(x => x.event_id !== id) }
// Evidence images stay in memory as object URLs; the demo's own examples are data URLs.
export const addEvidence = async (ev, file) => { const r = { id: uid(), event_id: ev.id, path: URL.createObjectURL(file), file_name: file.name || null, created_at: new Date().toISOString() }; (db.evidence ||= []).push(r); return structuredClone(r) }
export const deleteEvidence = async row => { db.evidence = db.evidence.filter(x => x.id !== row.id) }
export const evidenceUrls = async paths => Object.fromEntries(paths.map(p => [p, p]))
export const runScan = async () => { throw new Error('Demo mode: scanning is off') }
// v0.7: stage entries, undo restores, files, view link
export const addStageEvent = async (r, key, value, date = new Date().toISOString().slice(0, 10)) => addEvent({ material_id: r.material.id, evaluation_id: r.id, kind: 'stage', event_date: date, what: key, note: value == null ? null : String(value) })
export const restoreEvent = async row => { db.events.push(structuredClone(row)); return structuredClone(row) }
export const restoreEvidence = async rows => { (db.evidence ||= []).push(...structuredClone(rows)); return structuredClone(rows) }
export const removeEvidenceRows = async ids => { db.evidence = (db.evidence || []).filter(x => !ids.includes(x.id)) }
export const purgeFiles = async () => {}
export const setViewUrls = () => {}
export const fileUrl = async () => null
export const fetchShares = async () => [{ token: 'demo-link', created_at: new Date().toISOString() }]
export const createShare = async () => ({ token: 'demo-link-2', created_at: new Date().toISOString() })
export const revokeShare = async () => {}
export const fetchView = async () => { const { docs, glossary, ...rest } = db; return { data: structuredClone(rest), glossary: glossary || {}, urls: {} } }
export const fetchViewDoc = async (_t, id) => db.docs?.[id] ? { body: db.docs[id], updated_at: db.lastRun.finished_at } : null
