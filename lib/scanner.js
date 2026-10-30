// Reads the Raw Material Evaluation Document folder into plain rows.
// Read-only: never writes, renames or moves anything in that folder.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseTracker, verdictLine, revOf, toIsoDate, isComparisonFile, gradeAndCandidate, candidateFromBody } from './parse.js'

export const DEFAULT_ROOT = 'C:\\Users\\RDAlex2\\Desktop\\Everything\\APm Drug Files\\General\\Raw Material Evaluation Document'

// Root-level folders that aren't materials: .vscode, _Admin, _00_Project Origin, Old,
// dated meeting folders like "260730 RM Price Reduction Meeting Summary".
const NOT_MATERIAL = name => name.startsWith('_') || name.startsWith('.') || name === 'Old' || /^\d{6}\b/.test(name)
// Never descend into these when looking for comparison files.
const SKIP_DIRS = new Set(['Old', 'References', 'Document'])

const dirs = p => { try { return readdirSync(p, { withFileTypes: true }) } catch { return [] } }
const baseName = n => n.replace(/\s*\(R\.\d+_\d{6}\)\s*\.md$/i, '').toLowerCase()

export function scanFolder(root = DEFAULT_ROOT) {
  statSync(root) // throws a clear ENOENT if the folder isn't reachable
  const materials = [], evaluations = [], events = [], matOld = {}

  for (const top of dirs(root)) {
    if (!top.isDirectory() || NOT_MATERIAL(top.name)) continue
    const matFolder = top.name
    materials.push({ folder: matFolder, name: matFolder })

    // Comparison files, newest revision per folder.
    const walk = (rel, segs) => {
      const abs = join(root, rel)
      const entries = dirs(abs)
      const files = entries.filter(e => e.isFile() && isComparisonFile(e.name))
      if (files.length) {
        const pick = files.map(f => ({ name: f.name, ...revOf(f.name) }))
          .sort((a, b) => (b.rev ?? -1) - (a.rev ?? -1) || (b.revDate ?? '').localeCompare(a.revDate ?? ''))[0]
        const text = readFileSync(join(abs, pick.name), 'utf8')
        const base = baseName(pick.name)
        const oldDates = dirs(join(abs, 'Old')).filter(e => e.isFile() && baseName(e.name) === base).map(e => revOf(e.name).revDate).filter(Boolean)
        const allDates = [pick.revDate, ...oldDates].filter(Boolean).sort()
        const gc = gradeAndCandidate(segs, pick.name, matFolder)
        evaluations.push({
          folder: rel.replace(/\\/g, '/'),
          material_folder: matFolder,
          ...gc,
          candidate: gc.candidate ?? candidateFromBody(text, matFolder),
          file_name: pick.name,
          rev: pick.rev,
          rev_date: pick.revDate,
          first_rev_date: allDates[0] ?? null,
          tracker: parseTracker(text) ?? {},
          verdict_line: verdictLine(text),
          body: text,
        })
      }
      for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(join(rel, e.name), [...segs, e.name])
    }
    walk(matFolder, [])
    // Superseded material-wide comparisons (e.g. Etoricoxib's first file
    // covering all four candidates) count toward each candidate's first
    // verdict date — applied below once document dates are known.
    matOld[matFolder] = dirs(join(root, matFolder, 'Old')).filter(e => e.isFile() && isComparisonFile(e.name)).map(e => revOf(e.name).revDate).filter(Boolean)

    // Document\YYMMDD\ folders = a batch of documents received that day.
    const findDocs = rel => {
      for (const e of dirs(join(root, rel))) {
        if (!e.isDirectory() || e.name === 'Old' || e.name === 'References') continue
        const sub = join(rel, e.name)
        if (e.name !== 'Document') { findDocs(sub); continue }
        for (const d of dirs(join(root, sub))) {
          const date = d.isDirectory() && toIsoDate(d.name.slice(0, 6))
          if (!date) continue
          const files = dirs(join(root, sub, d.name)).filter(f => f.isFile()).map(f => f.name)
          events.push({
            source_ref: join(sub, d.name).replace(/\\/g, '/'),
            material_folder: matFolder,
            owner_folder: rel.replace(/\\/g, '/'),
            kind: 'docs_received',
            event_date: date,
            what: files.length ? `${files.length} file${files.length > 1 ? 's' : ''}: ${files.slice(0, 6).join('; ')}${files.length > 6 ? '; …' : ''}` : 'Empty folder',
          })
        }
      }
    }
    findDocs(matFolder)
  }

  // A candidate folder with documents but no comparison file yet (a new CoA
  // just landed) still gets a row, so it shows up as "Awaiting comparison".
  // A material-root Document folder only makes one when the material has no
  // evaluation at all (e.g. Mannitol); otherwise it's material-level intake.
  for (const ev of events) {
    if (evaluations.some(e => e.folder === ev.owner_folder)) continue
    const isRoot = ev.owner_folder === ev.material_folder
    if (isRoot && evaluations.some(e => e.material_folder === ev.material_folder)) continue
    const segs = isRoot ? [] : ev.owner_folder.split('/').slice(1)
    evaluations.push({
      folder: ev.owner_folder, material_folder: ev.material_folder,
      // with no file name to go on, a single sub-folder is read as the candidate
      ...(segs.length === 1 ? { grade: null, candidate: segs[0] } : gradeAndCandidate(segs, '', ev.material_folder)),
      file_name: null, rev: null, rev_date: null, first_rev_date: null, tracker: {}, verdict_line: null,
    })
  }

  // A Document folder belongs to the evaluation in the same folder, or — for
  // the older single-candidate layout — to the material's only evaluation.
  for (const ev of events) {
    const own = evaluations.find(e => e.folder === ev.owner_folder)
    const only = evaluations.filter(e => e.material_folder === ev.material_folder)
    ev.eval_folder = own ? own.folder : ev.owner_folder === ev.material_folder && only.length === 1 ? only[0].folder : null
    delete ev.owner_folder
  }

  // Earliest comparison on or after this candidate's first documents.
  for (const e of evaluations) {
    if (!e.file_name) continue
    const firstDocs = events.filter(x => x.eval_folder === e.folder).map(x => x.event_date).sort()[0]
    const shared = (matOld[e.material_folder] || []).filter(d => !firstDocs || d >= firstDocs)
    e.first_rev_date = [e.first_rev_date, ...shared].filter(Boolean).sort()[0] ?? null
  }
  return { root, materials, evaluations, events }
}
