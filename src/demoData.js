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
export const deleteEvent = async id => { db.events = db.events.filter(x => x.id !== id) }
export const runScan = async () => { throw new Error('Demo mode: scanning is off') }
