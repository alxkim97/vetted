// Turns raw rows into what the views show: effective fields (file tracker
// block over app value over scan guess), status, timeline and durations.
import { STAMPS, suggestStamp } from '../lib/parse.js'

export const STATUS = {
  pass:       { label: 'ผ่าน', tone: 'green', order: 3 },
  gap:        { label: 'ขาด', tone: 'amber', order: 2 },
  fail:       { label: 'ไม่ผ่าน', tone: 'red', order: 0 },
  closed_ok:  { label: 'Approved', tone: 'blue', order: 5, hint: 'Closed: Selection Form approved' },
  closed_no:  { label: 'Not approved', tone: 'slate', order: 1, hint: 'Closed: Selection Form not approved' },
  untagged:   { label: 'Not tagged', tone: 'violet', order: 4, hint: 'Has a verdict line; pick the stamp' },
  unreadable: { label: 'Not readable', tone: 'grey', order: 6, hint: 'Verdict only in a count table (older file)' },
  awaiting:   { label: 'No file yet', tone: 'violet', order: 4, hint: 'Documents in, no comparison file yet' },
}
export const STAMP_KEYS = STAMPS
export const EVENT_KINDS = {
  docs_received:  { label: 'Docs received', icon: 'inbox' },
  docs_requested: { label: 'Docs requested', icon: 'send' },
  message_sent:   { label: 'Message sent', icon: 'message' },
  verdict:        { label: 'Verdict', icon: 'check' },
  note:           { label: 'Note', icon: 'note' },
}

export const todayIso = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) // Bangkok
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)

// "2026-10-08" → "08-10-26" (APm's dd-mm-yy, as on the Selection Form)
export const fmtDate = d => d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(2, 4)}` : ''

export function buildRows({ materials, evaluations, events }) {
  const today = todayIso()
  const matById = Object.fromEntries(materials.map(m => [m.id, m]))
  const evByEval = {}
  for (const ev of events) if (ev.evaluation_id) (evByEval[ev.evaluation_id] ||= []).push(ev)

  return evaluations.filter(e => matById[e.material_id]).map(e => {
    const t = e.tracker || {}
    const m = matById[e.material_id]
    const evs = (evByEval[e.id] || []).slice().sort((a, b) => a.event_date.localeCompare(b.event_date))
    const stamp = STAMPS.includes(t.stamp) ? t.stamp : e.stamp
    const status = stamp || (!e.file_name ? 'awaiting' : e.verdict_line ? 'untagged' : 'unreadable')
    const received = evs.filter(x => x.kind === 'docs_received')
    const firstDocs = received[0]?.event_date ?? null
    const verdictDate = t.verdict_date || evs.find(x => x.kind === 'verdict')?.event_date || e.first_rev_date || null
    const open = evs.filter(x => x.kind === 'docs_requested' && !x.closed_on)
    const closed = status === 'closed_ok' || status === 'closed_no'
    const messages = evs.filter(x => x.kind === 'message_sent')
    const dates = [e.rev_date, ...evs.map(x => x.event_date)].filter(Boolean).sort()
    return {
      id: e.id, raw: e, material: m,
      materialName: m.name, grade: e.grade,
      candidate: t.candidate || e.candidate_name || e.candidate || null,
      supplier: t.supplier || e.supplier || null,
      manufacturer: t.manufacturer || e.manufacturer || null,
      avl: t.avl_listed ?? e.avl_listed ?? null,
      itemCode: t.item_code || e.item_code || null,
      kind: t.kind || m.kind || null,
      nextAction: t.next_action || e.next_action || null,
      fromFile: new Set(Object.keys(t)),
      stamp, status, suggested: stamp ? null : suggestStamp(e.verdict_line),
      verdictLine: e.verdict_line,
      fileName: e.file_name, folder: e.folder, rev: e.rev, revDate: e.rev_date,
      events: evs, firstDocs, verdictDate,
      daysToVerdict: firstDocs && verdictDate && verdictDate >= firstDocs ? daysBetween(firstDocs, verdictDate) : null,
      // How long it's been open since the first documents came in (stops counting once closed)
      ageDays: firstDocs && !closed ? daysBetween(firstDocs, today) : null,
      openRequests: open.map(x => ({ ...x, days: daysBetween(x.event_date, today) })),
      waitingDays: open.length ? Math.max(...open.map(x => daysBetween(x.event_date, today))) : null,
      lastMessage: messages[messages.length - 1] ?? null,
      lastActivity: dates[dates.length - 1] ?? null,
    }
  })
}

// Wait thresholds for the "waiting" chip: under 2 weeks fine, 2–4 weeks amber, beyond red.
export const waitTone = d => d == null ? '' : d > 28 ? 'red' : d > 14 ? 'amber' : 'ok'
