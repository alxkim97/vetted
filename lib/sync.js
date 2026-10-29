// Pushes a scanFolder() result into Supabase. Only writes scan-owned columns,
// so stamps, notes, supplier/manufacturer and logged events entered in the
// app or by a chat survive every rescan.
import { kindFromItemCode } from './parse.js'

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

export async function pushScan(supa, scan, trigger = 'cli') {
  const startedAt = new Date().toISOString()
  const run = must(await supa.from('rm_scan_runs').insert({ trigger, started_at: startedAt }).select('id').single())
  try {
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

    const summary = { materials: scan.materials.length, evaluations: scan.evaluations.length, events_added: added }
    must(await supa.from('rm_scan_runs').update({ ...summary, ok: true, finished_at: new Date().toISOString() }).eq('id', run.id))
    return summary
  } catch (e) {
    await supa.from('rm_scan_runs').update({ ok: false, error: String(e.message || e), finished_at: new Date().toISOString() }).eq('id', run.id)
    throw e
  }
}
