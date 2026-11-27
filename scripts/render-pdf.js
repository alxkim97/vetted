// Prints a comparison .md to the PDF next to it (same name, .pdf), A4
// landscape, Part 2 in the QC-sheet layout. Uses headless Edge launched from
// PowerShell with a fresh profile (launching it straight from git-bash has
// failed silently since an Edge update), then checks the output is a real PDF.
//   npm run pdf -- "<comparison .md>" [--html] [--out "<file.pdf>"]
//   --html writes only the HTML next to the .md (for a look in a browser)
import { readFileSync, writeFileSync, existsSync, statSync, mkdtempSync, rmSync, readFileSync as rd } from 'node:fs'
import { resolve, dirname, basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { renderHtml } from '../lib/render.js'

const args = process.argv.slice(2)
const flag = k => args.includes(k)
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const src = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out')
if (!src || !existsSync(src)) { console.error('Usage: npm run pdf -- "<comparison .md>" [--html] [--out "<file.pdf>"]'); process.exit(1) }

const md = resolve(src)
const stem = basename(md).replace(/\.md$/i, '')
const html = renderHtml(readFileSync(md, 'utf8'))
if (flag('--html')) {
  const out = join(dirname(md), `${stem}.html`)
  writeFileSync(out, html)
  console.log(`HTML written: ${out}`)
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'vetted-pdf-'))
const htmlPath = join(work, 'page.html')
writeFileSync(htmlPath, html)
const pdf = resolve(opt('--out') ?? join(dirname(md), `${stem}.pdf`))
const edge = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)
if (!edge) { console.error('Microsoft Edge not found.'); process.exit(1) }
const esc = s => s.replace(/'/g, "''")
const q = s => `'${s.replace(/'/g, "''")}'`
const ps = `$a = @('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--no-pdf-header-footer',` +
  `'--user-data-dir="${esc(join(work, 'profile'))}"','--print-to-pdf="${esc(pdf)}"',${q(pathToFileURL(htmlPath).href)}); ` +
  `$p = Start-Process -FilePath ${q(edge)} -ArgumentList $a -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode`
const before = existsSync(pdf) ? statSync(pdf).mtimeMs : 0
const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' })
try { rmSync(work, { recursive: true, force: true }) } catch { /* Edge may still hold the profile; it is in temp */ }

const ok = existsSync(pdf) && statSync(pdf).mtimeMs > before && rd(pdf).subarray(0, 5).toString() === '%PDF-'
if (!ok) {
  console.error(`No PDF written (Edge exit ${run.status}). ${run.stderr || ''}`.trim())
  console.error('If the PDF is open in a viewer, close it and run again.')
  process.exit(1)
}
const pages = (rd(pdf).toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length
console.log(`PDF written: ${pdf} (${pages} page${pages === 1 ? '' : 's'}, ${Math.round(statSync(pdf).size / 1024)} KB). Open it to check before sending.`)
