// Pushes a scanFolder() result into Supabase. Only writes scan-owned columns,
// so stamps, notes, supplier/manufacturer and logged events entered in the
// app or by a chat survive every rescan.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { kindFromItemCode } from './parse.js'
import { matchAvl } from './avl.js'

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

// A scan still running (started under 5 minutes ago, not finished) blocks a
// second one: interleaved writes would let the later scan's "not seen" sweep
// mark every folder removed.
const BUSY_MS = 5 * 60e3
export async function pushScan(supa, scan, trigger = 'cli', { upload = false } = {}) {
  const busy = must(await supa.from('rm_scan_runs').select('id,trigger,started_at').is('finished_at', null).gt('started_at', new Date(Date.now() - BUSY_MS).toISOString()).limit(1))
  if (busy.length) throw new Error(`Another scan (${busy[0].trigger}) is still running since ${busy[0].started_at}; try again in a few minutes`)
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

    // Document\YYMMDD\ folders renamed or deleted since: their scan-made entry
    // goes, unless something hangs off it (evidence images, or a note, party,
    // closed date or topic set in the app or by a chat).
    const ghosts = ghostDocEvents(
      await readAll(supa, 'rm_events', 'id,source,source_ref,kind,material_id,party,note,closed_on,topic'),
      { seen: new Set(evRows.map(r => r.source_ref)), materialIds: new Set(scan.materials.map(m => matId[m.folder]).filter(Boolean)),
        withEvidence: new Set((await readAll(supa, 'rm_evidence', 'event_id').catch(() => [])).map(x => x.event_id)) })
    for (let i = 0; i < ghosts.length; i += 100) must(await supa.from('rm_events').delete().in('id', ghosts.slice(i, i + 100)))

    // A tracker stage line that changed since the last scan is a dated stage
    // entry, dated by the file's revision (v0.7). Skipped before the v0.7 SQL.
    // A chat that logged the same change with rm-log already wrote it: skip a
    // stage whose latest entry for this evaluation already has this value.
    const lastStage = {}
    for (const x of (await readAll(supa, 'rm_events', 'evaluation_id,kind,what,note,event_date,created_at')).filter(x => x.kind === 'stage')
      .sort((a, b) => a.event_date.localeCompare(b.event_date) || String(a.created_at).localeCompare(String(b.created_at)))) lastStage[`${x.evaluation_id}|${x.what}`] = x.note
    const stageRows = []
    for (const e of scan.evaluations) {
      const id = evalId[e.folder]
      if (!id) continue
      const old = before[e.folder] || {}
      for (const [field, key] of STAGE_FIELDS) {
        const v = e.tracker?.[field]
        if (v == null || String(v) === String(old[field] ?? '')) continue
        if (lastStage[`${id}|${key}`] === String(v)) continue
        const date = [key === 'coa' && e.tracker.verdict_date, e.rev_date].find(d => d && d <= today()) || today()
        stageRows.push({ material_id: matId[e.material_folder], evaluation_id: id, kind: 'stage', event_date: date, what: key, note: String(v), source: 'scan' })
      }
    }
    if (stageRows.length) {
      const { error } = await supa.from('rm_events').insert(stageRows)
      if (error && !/kind_check|violates check/i.test(error.message)) throw error
    }

    await syncAvl(supa, scan)
    const uploaded = await syncFiles(supa, scan, { matId, evalId, startedAt, upload })

    const summary = { materials: scan.materials.length, evaluations: scan.evaluations.length, events_added: added }
    must(await supa.from('rm_scan_runs').update({ ...summary, ok: true, finished_at: new Date().toISOString() }).eq('id', run.id))
    return { ...summary, events_removed: ghosts.length, uploaded }
  } catch (e) {
    await supa.from('rm_scan_runs').update({ ok: false, error: String(e.message || e), finished_at: new Date().toISOString() }).eq('id', run.id)
    throw e
  }
}

// Ids of scan-made "documents received" entries whose folder this scan didn't
// see. Only within materials the scan read (a material folder that couldn't
// be read, or a scan that found nothing, removes nothing). An entry with
// evidence images, or with anything filled in beyond what the scan writes,
// is kept.
export function ghostDocEvents(rows, { seen, materialIds, withEvidence = new Set() }) {
  if (!seen.size) return []
  return rows.filter(r => r.source === 'scan' && r.kind === 'docs_received' && r.source_ref && /\/Document\/\d{6}/.test(r.source_ref)
    && !seen.has(r.source_ref) && materialIds.has(r.material_id) && !withEvidence.has(r.id)
    && r.party == null && r.note == null && r.closed_on == null && r.topic == null).map(r => r.id)
}

// Each candidate against QA's AVL, into rm_evaluations.avl_match (scan-owned;
// a value set by hand in avl_listed always wins in the app). Names typed in
// the app come first, then the comparison file's, then the folder's. Skipped
// when the AVL file couldn't be read, or before the v0.7.2 SQL.
// jsonb comes back with its keys in its own order.
const canon = v => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${k}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v ?? null)
async function syncAvl(supa, scan) {
  if (!scan.avl) return
  let rows
  try { rows = await readAll(supa, 'rm_evaluations', 'id,folder,grade,candidate,candidate_name,manufacturer,tracker,avl_match') } catch (error) { if (/avl_match|42703|PGRST204/.test(`${error.code} ${error.message}`)) return; throw error }
  const matName = Object.fromEntries(scan.evaluations.map(e => [e.folder, e.material_folder]))
  for (const e of rows.filter(x => matName[x.folder])) {
    const name = e.manufacturer || e.tracker?.manufacturer || e.candidate_name || e.tracker?.candidate || e.candidate
    const m = matchAvl(scan.avl, { material: matName[e.folder], grade: e.grade, manufacturer: name })
    if (canon(m) !== canon(e.avl_match)) must(await supa.from('rm_evaluations').update({ avl_match: m }).eq('id', e.id))
  }
}

// Every document in the Document\YYMMDD\ folders as an rm_files row (name,
// date, size). With upload on, each evaluation's newest Selection Form and CoA
// go to the private rm-files bucket, re-sent only when the file changed; a
// file that's no longer the newest is taken out of the bucket. Skipped before
// the v0.7 SQL. Returns how many files were uploaded.
async function syncFiles(supa, scan, { matId, evalId, startedAt, upload }) {
  let have
  try { have = await readAll(supa, 'rm_files', 'id,rel,mtime,path,evaluation_id') } catch (error) { if (/rm_files|42P01|PGRST205/.test(`${error.code} ${error.message}`)) return 0; throw error }
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
