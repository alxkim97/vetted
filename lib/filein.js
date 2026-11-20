// Files new scans and sample photos into the RM evaluation folder from a
// manifest the inbox chat writes. For each item: copy the file into
// <Material>\<Candidate>\Document\YYMMDD\ (a sample photo: the flat
// <Material>\<Candidate>\Sample\, dated by its name) under its new name, check the copy,
// then rename the original in place (scan\ or dumpout\) to the same name.
// Never overwrites, never deletes, never moves.
//
// planFiling() only reads and says what would happen; applyPlan() does it.
// Manifest: { "items": [{ "src": "<absolute path in scan\ or dumpout\>",
//   "name": "YYMMDD <new file name>.<same extension>",
//   "dest": "<Material>\\<Candidate>\\Document\\YYMMDD",   (relative to the RM folder)
//        or "<Material>\\<Candidate>\\Sample" for a sample photo
//   "newCandidate": true, "newMaterial": true }] }           (only when meant)
import { existsSync, statSync, readFileSync, readdirSync, copyFileSync, renameSync, mkdirSync, appendFileSync, constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve, dirname, basename, extname, relative, isAbsolute, sep } from 'node:path'
import { toIsoDate } from './parse.js'
import { DOC_FILE, SAMPLE_FILE, SAMPLE_NAME } from './scanner.js'
import { isAnnotatedForm, formWords } from '../src/model.js'

export const DEFAULT_SOURCES = ['C:\\Users\\RDAlex2\\Desktop\\scan', 'C:\\Users\\RDAlex2\\Downloads\\dumpout']
const UPLOADABLE = /\.(png|jpe?g|webp|gif)$/i // what rm-log --image takes
const IMAGE = /\.(png|jpe?g|webp|gif|heic|heif|tiff?|bmp)$/i
const BAD_CHARS = /[<>:"/\\|?*\x00-\x1f]/

const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase()
const inside = (child, parent) => { const r = relative(parent, child); return !!r && !r.startsWith('..') && !isAbsolute(r) }
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const isFile = p => { try { return statSync(p).isFile() } catch { return false } }
const isDir = p => { try { return statSync(p).isDirectory() } catch { return false } }
const hasEvalFolders = dir => { try { return readdirSync(dir, { withFileTypes: true }).some(e => e.isDirectory() && !['Old', 'References', 'Document'].includes(e.name)) } catch { return false } }

export function planFiling(manifest, { root, sources = DEFAULT_SOURCES } = {}) {
  if (!root) throw new Error('planFiling needs the RM folder (root)')
  const list = Array.isArray(manifest) ? manifest : manifest?.items
  if (!Array.isArray(list) || !list.length) throw new Error('The manifest has no items')

  const items = list.map((it, i) => {
    const errors = [], warnings = [], flags = []
    const out = { n: i + 1, src: it.src ?? null, name: it.name ?? null, dest: it.dest ?? null, errors, warnings, flags, copy: false, rename: false }
    if (typeof it.src !== 'string' || !isAbsolute(it.src)) { errors.push('src must be the absolute path of the file in scan\\ or dumpout\\'); return out }
    if (typeof it.name !== 'string' || !it.name.trim()) { errors.push('name is missing'); return out }
    if (typeof it.dest !== 'string' || !it.dest.trim()) { errors.push('dest is missing'); return out }
    const src = resolve(it.src), name = it.name
    const from = sources.find(s => inside(src, resolve(s)))
    out.from = from ? relative(dirname(resolve(from)), src) : src
    if (!from) errors.push(`src is not inside ${sources.join(' or ')}`)

    // The new name: "YYMMDD Name.ext", received-document style.
    if (basename(name) !== name || BAD_CHARS.test(name)) errors.push('name has a character Windows file names can\'t hold (\\ / : * ? " < > |)')
    if (/[ .]$/.test(name)) errors.push('name ends with a space or a dot')
    const prefix = name.match(/^(\d{6}) \S/)?.[1]
    const nameDate = prefix && toIsoDate(prefix)
    if (!nameDate) errors.push('name must start with the received date as YYMMDD and a space')
    if (/\(R\.\d+_\d{6}\)/i.test(name)) errors.push('name carries an (R.X_YYMMDD) revision marker; received documents take the YYMMDD prefix only')
    if (name.includes('_')) errors.push('name has an underscore; use spaces')
    if (extname(name).toLowerCase() !== extname(src).toLowerCase()) errors.push(`name changes the extension (${extname(src) || 'none'} → ${extname(name) || 'none'}); keep the original`)

    // Where it goes: <Material>[\<Grade>][\<Candidate>]\Document\YYMMDD
    const destDir = resolve(root, it.dest)
    if (!inside(destDir, resolve(root))) { errors.push('dest is outside the RM folder'); return out }
    const segs = relative(resolve(root), destDir).split(sep)
    out.destRel = segs.join('\\') + '\\'
    // A sample photo goes in the flat <Candidate>\Sample (no date folder; Vetted
    // dates it from the name), and only there.
    const isSample = segs.length >= 3 && segs[segs.length - 1] === 'Sample'
    out.sample = isSample
    const looksLikeSample = SAMPLE_FILE.test(name) && SAMPLE_NAME.test(name)
    if (isSample && !SAMPLE_FILE.test(name)) errors.push('only photos (png, jpg/jpeg) go in Sample\\')
    else if (isSample && !SAMPLE_NAME.test(name)) errors.push('a sample photo is named "YYMMDD <Material> Sample (<Manufacturer>, Lot <lot>, <qty>) - <n>.<ext>"')
    if (!isSample && looksLikeSample) errors.push(`sample photos go in <Candidate>\\Sample, not in Document\\`)
    const folderDate = isSample ? nameDate
      : segs.length >= 3 && segs[segs.length - 2] === 'Document' && /^\d{6}$/.test(segs[segs.length - 1]) ? toIsoDate(segs[segs.length - 1]) : null
    if (!folderDate) { if (!isSample) errors.push('dest must end in \\Document\\YYMMDD (a real date) or \\Sample, below a material folder'); return out }
    const material = segs[0]
    if (/^[_.]/.test(material) || material === 'Old' || /^\d{6}\b/.test(material)) errors.push(`"${material}" is not a material folder`)
    if (segs.some(s => s === 'Old' || s === 'References')) errors.push('dest is inside Old\\ or References\\')
    if (!isSample && nameDate && nameDate !== folderDate) warnings.push(`name date ${prefix} differs from the Document folder date ${segs[segs.length - 1]}`)

    const matDir = join(root, material)
    const ownerSegs = segs.slice(0, isSample ? -1 : -2)
    const ownerDir = join(root, ...ownerSegs)
    if (!isDir(matDir)) {
      if (it.newMaterial) flags.push('NEW MATERIAL FOLDER')
      else errors.push(`no material folder "${material}"; check the spelling, or set newMaterial if it's really new`)
    }
    if (!isDir(ownerDir) && isDir(matDir)) {
      if (it.newCandidate || it.newMaterial) flags.push('NEW CANDIDATE FOLDER (a new evaluation in Vetted)')
      else errors.push(`no folder ${ownerSegs.join('\\')}; check the spelling, or set newCandidate if this is a new candidate`)
      // Flat layout: documents straight under Material\Document. A first
      // candidate folder makes a second evaluation; once it has a comparison
      // file, the material-level row drops out of Vetted with whatever was logged on it.
      if (segs.length > 3 && isDir(join(matDir, 'Document')) && !hasEvalFolders(matDir))
        warnings.push(`${material} keeps its documents in ${material}\\Document (flat layout); a candidate folder starts a separate evaluation and can strand what was logged on the material-level one`)
    }
    if (!isDir(destDir)) flags.push(isSample ? 'NEW SAMPLE FOLDER' : 'NEW DATE FOLDER')

    // Current state on disk: not done, half done (copied or renamed), or done.
    const renamedPath = join(dirname(src), name)
    const already = same(src, renamedPath)
    const original = isFile(src) ? src : !already && isFile(renamedPath) ? renamedPath : null
    out.original = original
    out.renamedPath = renamedPath
    if (!original) { errors.push('source file not found (under either its old or its new name)'); return out }
    if (!already && isFile(src) && isFile(renamedPath)) errors.push(`a different file named "${name}" is already in ${basename(dirname(src))}\\`)
    out.rename = !same(original, renamedPath)
    const destFile = join(destDir, name)
    out.destFile = destFile
    if (isFile(destFile)) {
      if (sha(destFile) === sha(original)) flags.push('ALREADY COPIED')
      else errors.push(`a different file with this name is already in ${isSample ? 'Sample\\' : 'the Document folder'}`)
    } else out.copy = true
    if (!out.copy && !out.rename) flags.push('DONE')

    // What Vetted will read from it.
    if (isAnnotatedForm(name)) {
      out.verdict = formWords(name)
      if (!out.verdict.length) warnings.push('signed form with no verdict word (ผ่าน / ขาด / ไม่ผ่าน): Vetted won\'t date the CoA or Docs stage from it')
    }
    if (!DOC_FILE.test(name)) warnings.push(`Vetted doesn't list ${extname(name)} files from Document folders`)
    if (IMAGE.test(name) && !UPLOADABLE.test(name)) warnings.push(`${extname(name)} can't be attached in Vetted (png, jpg, webp, gif only); convert it first`)
    return out
  })

  // Across items: two items onto one file, or one file given two names.
  const byDest = {}, bySrc = {}
  for (const x of items) {
    if (x.destFile) (byDest[x.destFile.toLowerCase()] ||= []).push(x)
    if (x.original) (bySrc[x.original.toLowerCase()] ||= []).push(x)
  }
  for (const g of Object.values(byDest)) if (g.length > 1) for (const x of g) x.errors.push(`same destination file as item ${g.filter(y => y !== x).map(y => y.n).join(', ')}`)
  for (const g of Object.values(bySrc)) if (new Set(g.map(x => x.name)).size > 1) for (const x of g) x.errors.push(`the same source file gets different names in items ${g.map(y => y.n).join(', ')}`)

  return { root, items, ok: items.every(x => !x.errors.length) }
}

// Copies first (never over an existing file), checks each copy byte for byte,
// then renames each original once all its copies are in. Stops at the first
// problem; what was done before it is in `done` and in the log.
export function applyPlan(plan, { logFile } = {}) {
  if (!plan.ok) throw new Error('The plan has errors; nothing was changed')
  const done = [], at = new Date().toISOString()
  const log = row => { if (!logFile) return; mkdirSync(dirname(logFile), { recursive: true }); appendFileSync(logFile, JSON.stringify(row) + '\n') }
  const groups = {}
  for (const x of plan.items) (groups[x.original.toLowerCase()] ||= []).push(x)
  try {
    for (const g of Object.values(groups)) {
      const hash = sha(g[0].original)
      for (const x of g) {
        if (!x.copy) continue
        mkdirSync(dirname(x.destFile), { recursive: true })
        copyFileSync(x.original, x.destFile, constants.COPYFILE_EXCL)
        if (sha(x.destFile) !== hash) throw new Error(`the copy of item ${x.n} doesn't match the original; check ${x.destFile}`)
        done.push({ n: x.n, step: 'copied', file: x.destFile })
        log({ at, step: 'copied', src: x.original, to: x.destFile, sha256: hash })
      }
      const x = g[0]
      if (x.rename) {
        if (existsSync(x.renamedPath)) throw new Error(`"${basename(x.renamedPath)}" appeared in the inbox folder while filing; item ${x.n} not renamed`)
        renameSync(x.original, x.renamedPath)
        done.push({ n: x.n, step: 'renamed', file: x.renamedPath })
        log({ at, step: 'renamed', from: x.original, to: x.renamedPath, sha256: hash })
      }
    }
  } catch (e) {
    return { done, error: e.message || String(e) }
  }
  return { done, error: null }
}
