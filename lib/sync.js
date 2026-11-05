// Pushes a scanFolder() result into Supabase. Only writes scan-owned columns,
// so stamps, notes, supplier/manufacturer and logged events entered in the
// app or by a chat survive every rescan.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { kindFromItemCode } from './parse.js'

const STAGE_FIELDS = [['avl_listed', 'avl'], ['coa', 'coa'], ['docs', 'docs'], ['qc', 'qc'], ['outcome', 'outcome']]
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) // Bangkok
// Storage keys: plain ASCII, so a Thai or bracketed file name still uploads.
const safeKey = s => s.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(-120)

async function readAll(supa, table, cols) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa.from(table).select(cols).range(from, from + 999)
    if (error) throw error
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}
const must = ({ data, error }) => { if (error) throw error; return data }

export async function pushScan(supa, scan, trigger = 'cli', { upload = false } = {}) {
  const startedAt = new Date().toISOString()
  const run = must(await supa.from('rm_scan_runs').insert({ trigger, started_at: startedAt }).select('id').single())
  try {
    // Tracker blocks as they were, to log what a revised file changed.
    const before = Object.fromEntries((await readAll(supa, 'rm_evaluations', 'folder,tracker')).map(e => [e.folder, e.tracker || {}]))

    // Materials
    must(await supa.from('rm_materials').upsert(
      scan.materials.map(m => ({ folder: m.folder, name: m.name, scan_seen_at: startedAt, removed_at: null })),
      { onConflict: 'folder' }))
    const mats = await readAll(supa, 'rm_materials', 'id,folder,kind')
    const matId = Object.fromEntries(mats.map(m => [m.folder, m.id]))

    // Evaluations (scan-owned columns only — same key set on every row)
    must(await supa.from('rm_evaluations').upsert(scan.evaluations.map(e => ({
      folder: e.folder, material_id: matId[e.material_folder], grade: e.grade, candidate: e.candidate,
      file_name: e.file_name, rev: e.rev, rev_date: e.rev_date, first_rev_date: e.first_rev_date,
      tracker: e.tracker, verdict_line: e.verdict_line, scan_seen_at: startedAt, removed_at: null,
    })), { onConflict: 'folder' }))
    const evals = await readAll(supa, 'rm_evaluations', 'id,folder,material_id,item_code,tracker')
    const evalId = Object.fromEntries(evals.map(e => [e.folder, e.id]))

    // The comparison file itself, for the full evaluation page. Skipped (not
    // failed) while rm_eval_docs doesn't exist yet, so older setups keep scanning.
    const docs = scan.evaluations.filter(e => e.body && evalId[e.folder]).map(e => ({ evaluation_id: evalId[e.folder], body: e.body, updated_at: startedAt }))
    for (let i = 0; i < docs.length; i += 10) {
      const { error } = await supa.from('rm_eval_docs').upsert(docs.slice(i, i + 10), { onConflict: 'evaluation_id' })
      if (error && /rm_eval_docs|42P01|PGRST205/.test(`${error.code} ${error.message}`)) break
      if (error) throw error
    }

    // Folders that disappeared since the last scan
    must(await supa.from('rm_materials').update({ removed_at: startedAt }).lt('scan_seen_at', startedAt).is('removed_at', null))
    must(await supa.from('rm_evaluations').update({ removed_at: startedAt }).lt('scan_seen_at', startedAt).is('removed_at', null))

    // API vs excipient: tracker block first, then a guess from the item code.
    // Never overwrites a kind that's already set.
    for (const m of mats.filter(m => !m.kind)) {
      const mine = evals.filter(e => e.material_id === m.id)
      const kind = mine.map(e => e.tracker?.kind).find(Boolean) || mine.map(e => kindFromItemCode(e.tracker?.item_code || e.item_code)).find(Boolean)
      if (kind) must(await supa.from('rm_materials').update({ kind }).eq('id', m.id))
    }

    // Document\YYMMDD\ events
    const known = new Set((await readAll(supa, 'rm_events', 'source_ref')).map(r => r.source_ref).filter(Boolean))
    const evRows = scan.events.map(ev => ({
      source_ref: ev.source_ref, source: 'scan', kind: ev.kind, event_date: ev.event_date, what: ev.what,
      material_id: matId[ev.material_folder], evaluation_id: ev.eval_folder ? evalId[ev.eval_folder] ?? null : null,
    }))
    if (evRows.length) must(await supa.from('rm_events').upsert(evRows, { onConflict: 'source_ref' }))
    const added = evRows.filter(r => !known.has(r.source_ref)).length

    // A tracker stage line that changed since the last scan is a dated stage
    // entry, dated by the file's revision (v0.7). Skipped before the v0.7 SQL.
    const stageRows = []
    for (const e of scan.evaluations) {
      const id = evalId[e.folder]
      if (!id) continue
      const old = before[e.folder] || {}
      for (const [field, key] of STAGE_FIELDS) {
        const v = e.tracker?.[field]
        if (v == null || String(v) === String(old[field] ?? '')) continue
        const date = [key === 'coa' && e.tracker.verdict_date, e.rev_date].find(d => d && d <= today()) || today()
        stageRows.push({ material_id: matId[e.material_folder], evaluation_id: id, kind: 'stage', event_date: date, what: key, note: String(v), source: 'scan' })
      }
    }
    if (stageRows.length) {
      const { error } = await supa.from('rm_events').insert(stageRows)
      if (error && !/kind_check|violates check/i.test(error.message)) throw error
    }

    const uploaded = await syncFiles(supa, scan, { matId, evalId, startedAt, upload })

    const summary = { materials: scan.materials.length, evaluations: scan.evaluations.length, events_added: added }
    must(await supa.from('rm_scan_runs').update({ ...summary, ok: true, finished_at: new Date().toISOString() }).eq('id', run.id))
    return { ...summary, uploaded }
  } catch (e) {
    await supa.from('rm_scan_runs').update({ ok: false, error: String(e.message || e), finished_at: new Date().toISOString() }).eq('id', run.id)
    throw e
  }
}

// Every document in the Document\YYMMDD\ folders as an rm_files row (name,
// date, size). With upload on, each evaluation's newest Selection Form and CoA
// go to the private rm-files bucket, re-sent only when the file changed; a
// file that's no longer the newest is taken out of the bucket. Skipped before
// the v0.7 SQL. Returns how many files were uploaded.
async function syncFiles(supa, scan, { matId, evalId, startedAt, upload }) {
  const { data: have, error } = await supa.from('rm_files').select('id,rel,mtime,path,evaluation_id')
  if (error) { if (/rm_files|42P01|PGRST205/.test(`${error.code} ${error.message}`)) return 0; throw error }
  const byRel = Object.fromEntries(have.map(f => [f.rel, f]))
  const rows = scan.files.map(f => ({
    rel: f.rel, name: f.name, doc_date: f.doc_date, size: f.size, mtime: f.mtime, scan_seen_at: startedAt,
    material_id: matId[f.material_folder], evaluation_id: f.eval_folder ? evalId[f.eval_folder] ?? null : null,
  }))
  for (let i = 0; i < rows.length; i += 200) must(await supa.from('rm_files').upsert(rows.slice(i, i + 200), { onConflict: 'rel' }))
  // Without upload, rows of vanished files go unless they still point at a
  // stored copy (the next upload run removes those from the bucket first).
  if (!upload) { must(await supa.from('rm_files').delete().lt('scan_seen_at', startedAt).is('path', null)); return 0 }
  let sent = 0
  const keep = new Set()
  for (const f of scan.files.filter(x => x.upload)) {
    const old = byRel[f.rel]
    const evId = f.eval_folder ? evalId[f.eval_folder] : null
    const path = `${evId || matId[f.material_folder]}/${f.doc_date}-${safeKey(f.name)}`
    keep.add(f.rel)
    if (old?.path && old.mtime && f.mtime && new Date(old.mtime).getTime() === new Date(f.mtime).getTime()) continue
    must(await supa.storage.from('rm-files').upload(path, readFileSync(join(scan.root, f.rel)), { contentType: 'application/pdf', upsert: true }))
    must(await supa.from('rm_files').update({ path, uploaded_at: new Date().toISOString() }).eq('rel', f.rel))
    sent++
  }
  // Older forms that a newer scan replaced, and files that left the folder.
  const stale = have.filter(f => f.path && !keep.has(f.rel))
  if (stale.length) {
    await supa.storage.from('rm-files').remove(stale.map(f => f.path))
    must(await supa.from('rm_files').update({ path: null, uploaded_at: null }).in('id', stale.map(f => f.id)))
  }
  must(await supa.from('rm_files').delete().lt('scan_seen_at', startedAt))
  return sent
}
