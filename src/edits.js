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
import { splitAsks } from './handoff.js'

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

export async function setReceived(reqId, on, date = todayIso()) {
  const apply = async v => put(state.data.events, await updateEvent(reqId, { closed_on: v }))
  await apply(on ? date : null)
  record({ label: on ? 'Marked received' : 'Request reopened', undo: () => apply(on ? null : date), redo: () => apply(on ? date : null) })
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

// Events plus their images as one undo step (the images go with their event).
function recordMade(label, made, imgs) {
  record({
    label,
    undo: async () => {
      for (const x of made) await deleteEvent(x.id)
      drop('events', made.map(x => x.id)); drop('evidence', imgs.map(x => x.id))
      markForPurge(imgs.map(x => x.path))
    },
    redo: async () => {
      for (const x of made) state.data.events.push(await restoreEvent(stripEv(x)))
      state.data.evidence.push(...await restoreEvidence(imgs.map(stripImg)))
    },
  })
}

// Message sent to PU plus the requests it makes, and its LINE screenshot, as
// one undo step. A sample ask becomes its own sample request (the QC sample tracker).
export async function logSent(r, { message, asks, party = 'PU', date = todayIso(), files = [] }) {
  const base = { material_id: r.material.id, evaluation_id: r.id, event_date: date, party }
  const msg = await addEvent({ ...base, kind: 'message_sent', note: message })
  const made = [msg], imgs = []
  const { data, sample } = splitAsks(asks)
  if (data.length) made.push(await addEvent({ ...base, kind: 'docs_requested', what: data.join('; ') }))
  if (sample.length) made.push(await addEvent({ ...base, kind: 'docs_requested', what: sample.join('; '), topic: 'sample' }))
  for (const f of files) imgs.push(await addEvidence(msg, f))
  state.data.events.push(...made)
  state.data.evidence = [...(state.data.evidence || []), ...imgs]
  recordMade('Message logged', made, imgs)
  changed()
  return msg
}

// One message (the multi-material reply) logged on every evaluation it covers,
// each with its own copy of the screenshot.
export async function logSentMany(rows, { note, party = 'PU', date = todayIso(), files = [] }) {
  const made = [], imgs = []
  for (const r of rows) {
    const msg = await addEvent({ material_id: r.material.id, evaluation_id: r.id, kind: 'message_sent', event_date: date, party, note })
    made.push(msg)
    for (const f of files) imgs.push(await addEvidence(msg, f))
  }
  state.data.events.push(...made)
  state.data.evidence = [...(state.data.evidence || []), ...imgs]
  recordMade(`Reply logged on ${made.length} evaluation${made.length === 1 ? '' : 's'}`, made, imgs)
  changed()
  return made
}

// The decision's date: moves its stage entry (and clears "estimated"), or
// adds the entry when the decision was never logged with a date.
export async function setDecisionDate(r, date) {
  const v = r.stages.outcome
  const hit = state.data.events.filter(x => x.evaluation_id === r.id && x.kind === 'stage' && x.what === 'outcome' && x.note === String(v)).pop()
  if (hit) {
    const prev = { event_date: hit.event_date, estimated: !!hit.estimated }
    const apply = async p => put(state.data.events, await updateEvent(hit.id, p))
    await apply({ event_date: date, estimated: false })
    record({ label: 'Decision date set', undo: () => apply(prev), redo: () => apply({ event_date: date, estimated: false }) })
  } else {
    let ev = await addStageEvent(r, 'outcome', v, date)
    state.data.events.push(ev)
    record({
      label: 'Decision date set',
      undo: async () => { await deleteEvent(ev.id); drop('events', [ev.id]) },
      redo: async () => { ev = await restoreEvent(stripEv(ev)); state.data.events.push(ev) },
    })
  }
  toast(`Decision dated ${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(2, 4)}`)
  changed()
}

// QC sample result: the QC stage on that date, and the analysis request to QC closed.
export async function setQcResult(r, value, date = todayIso()) {
  const prev = r.raw.qc ?? null
  const sentId = r.sample?.sentId
  const sentOpen = sentId && !state.data.events.find(x => x.id === sentId)?.closed_on
  let stageEv = null
  const apply = async () => {
    await writeEval(r.id, { qc: value })
    try { stageEv = await addStageEvent(r, 'qc', value, date); state.data.events.push(stageEv) } catch { stageEv = null }
    if (sentOpen) put(state.data.events, await updateEvent(sentId, { closed_on: date }))
  }
  await apply()
  record({
    label: 'QC result set',
    undo: async () => {
      await writeEval(r.id, { qc: prev })
      if (stageEv) { await deleteEvent(stageEv.id); drop('events', [stageEv.id]) }
      if (sentOpen) put(state.data.events, await updateEvent(sentId, { closed_on: null }))
    },
    redo: apply,
  })
  toast(`QC sample: ${value === 'approved' ? 'Approved' : 'Not approved'}`)
  changed()
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
