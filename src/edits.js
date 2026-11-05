// Every change the app makes, each recorded so Ctrl+Z can take it back.
// They patch state.data in place after the write, then redraw.
import { state, rebuild, cacheData } from './store.js'
import { todayIso } from './model.js'
import {
  updateEvaluation, updateMaterial, addEvent, addStageEvent, updateEvent, deleteEvent,
  restoreEvent, restoreEvidence, removeEvidenceRows, addEvidence, deleteEvidence,
} from './data.js'
import { record, hooks, markForPurge } from './undo.js'
import { toast } from './ui.js'

const put = (list, row) => { const i = list.findIndex(x => x.id === row.id); if (i >= 0) list[i] = row; else list.push(row) }
const drop = (key, ids) => { const s = new Set(ids); state.data[key] = (state.data[key] || []).filter(x => !s.has(x.id)) }
const evidenceOf = evId => (state.data.evidence || []).filter(x => x.event_id === evId)
function changed() { rebuild(); cacheData(); hooks.changed() }

// The column a stage writes to (the AVL check is avl_listed).
export const COLUMN = { avl: 'avl_listed', coa: 'coa', docs: 'docs', qc: 'qc', outcome: 'outcome' }

async function writeEval(id, patch) { put(state.data.evaluations, await updateEvaluation(id, patch)) }

// A stage value plus its dated 'stage' entry. Without the v0.7 SQL the entry
// can't be written; the value still is.
export async function setStage(r, key, value, label) {
  const col = COLUMN[key]
  const prev = r.raw[col] ?? null
  let stageEv = null
  const apply = async () => {
    await writeEval(r.id, { [col]: value })
    try { stageEv = await addStageEvent(r, key, value); state.data.events.push(stageEv) } catch { stageEv = null }
  }
  await apply()
  record({
    label,
    undo: async () => {
      await writeEval(r.id, { [col]: prev })
      if (stageEv) { await deleteEvent(stageEv.id); drop('events', [stageEv.id]) }
    },
    redo: apply,
  })
  toast(label)
  changed()
}

export async function saveFields(r, patch, kind) {
  const prev = Object.fromEntries(Object.keys(patch).map(k => [k, r.raw[k] ?? null]))
  const prevKind = r.material.kind ?? null
  const apply = async (p, k) => {
    await writeEval(r.id, p)
    if (k !== undefined && k !== (state.data.materials.find(m => m.id === r.material.id)?.kind ?? null)) put(state.data.materials, await updateMaterial(r.material.id, { kind: k }))
  }
  await apply(patch, kind)
  record({ label: 'Details saved', undo: () => apply(prev, kind === undefined ? undefined : prevKind), redo: () => apply(patch, kind) })
  toast('Saved')
  changed()
}

export async function setReceived(reqId, on) {
  const apply = async v => put(state.data.events, await updateEvent(reqId, { closed_on: v }))
  await apply(on ? todayIso() : null)
  record({ label: on ? 'Marked received' : 'Request reopened', undo: () => apply(on ? null : todayIso()), redo: () => apply(on ? todayIso() : null) })
  toast(on ? 'Marked received · Ctrl+Z to undo' : 'Request reopened')
  changed()
}

// New timeline entry, its images, and (for received documents) the requests it closes.
export async function addEntry(r, fields, files = [], closeIds = []) {
  let ev, imgs = []
  const closeAll = async v => { for (const id of closeIds) put(state.data.events, await updateEvent(id, { closed_on: v })) }
  ev = await addEvent({ material_id: r.material.id, evaluation_id: r.id, ...fields })
  state.data.events.push(ev)
  for (const f of files) imgs.push(await addEvidence(ev, f))
  state.data.evidence = [...(state.data.evidence || []), ...imgs]
  await closeAll(fields.event_date)
  record({
    label: 'Entry added',
    undo: async () => {
      await deleteEvent(ev.id); drop('events', [ev.id]); drop('evidence', imgs.map(x => x.id))
      markForPurge(imgs.map(x => x.path))
      await closeAll(null)
    },
    redo: async () => {
      state.data.events.push(await restoreEvent(stripEv(ev)))
      state.data.evidence.push(...await restoreEvidence(imgs.map(stripImg)))
      await closeAll(fields.event_date)
    },
  })
  changed()
  return ev
}

// Message sent to PU plus the request it makes, as one undo step.
export async function logSent(r, { message, asks, party = 'PU' }) {
  const date = todayIso()
  const made = []
  made.push(await addEvent({ material_id: r.material.id, evaluation_id: r.id, kind: 'message_sent', event_date: date, party, note: message }))
  if (asks.length) made.push(await addEvent({ material_id: r.material.id, evaluation_id: r.id, kind: 'docs_requested', event_date: date, party, what: asks.join('; ') }))
  state.data.events.push(...made)
  record({
    label: 'Message logged',
    undo: async () => { for (const x of made) await deleteEvent(x.id); drop('events', made.map(x => x.id)) },
    redo: async () => { for (const x of made) state.data.events.push(await restoreEvent(stripEv(x))) },
  })
  changed()
  return made[made.length - 1]
}

export async function deleteEntry(ev) {
  const imgs = evidenceOf(ev.id)
  await deleteEvent(ev.id)
  drop('events', [ev.id]); drop('evidence', imgs.map(x => x.id))
  markForPurge(imgs.map(x => x.path))
  record({
    label: 'Entry deleted',
    undo: async () => {
      state.data.events.push(await restoreEvent(stripEv(ev)))
      state.data.evidence.push(...await restoreEvidence(imgs.map(stripImg)))
    },
    redo: async () => { await deleteEvent(ev.id); drop('events', [ev.id]); drop('evidence', imgs.map(x => x.id)) },
  })
  toast('Entry deleted · Ctrl+Z to undo')
  changed()
}

export async function addImages(ev, files) {
  const imgs = []
  for (const f of files) imgs.push(await addEvidence(ev, f))
  state.data.evidence = [...(state.data.evidence || []), ...imgs]
  record({
    label: imgs.length > 1 ? `${imgs.length} images added` : 'Image added',
    undo: async () => { await removeEvidenceRows(imgs.map(x => x.id)); drop('evidence', imgs.map(x => x.id)); markForPurge(imgs.map(x => x.path)) },
    redo: async () => { state.data.evidence.push(...await restoreEvidence(imgs.map(stripImg))) },
  })
  toast(imgs.length > 1 ? `${imgs.length} images added` : 'Image added')
  changed()
}

export async function deleteImage(row) {
  await deleteEvidence(row)
  drop('evidence', [row.id]); markForPurge([row.path])
  record({
    label: 'Image deleted',
    undo: async () => { state.data.evidence.push(...await restoreEvidence([stripImg(row)])) },
    redo: async () => { await deleteEvidence(row); drop('evidence', [row.id]) },
  })
  toast('Image deleted · Ctrl+Z to undo')
  changed()
}

// Columns a re-insert may carry (created_by comes from the session again).
const stripEv = ({ id, material_id, evaluation_id, kind, event_date, what, party, note, closed_on, source, topic, estimated }) =>
  ({ id, material_id, evaluation_id, kind, event_date, what, party, note, closed_on, source, ...(topic ? { topic } : {}), ...(estimated ? { estimated } : {}) })
const stripImg = ({ id, event_id, path, file_name }) => ({ id, event_id, path, file_name })
