// Scans the RM evaluation folder and pushes it to Supabase.
// Usage: node scripts/scan.js [--dry] [--trigger schedule] [--root "<folder>"]
//   --dry   print what was found, write nothing
import { scanFolder, DEFAULT_ROOT } from '../lib/scanner.js'
import { pushScan } from '../lib/sync.js'

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const root = arg('--root') || process.env.RM_ROOT || DEFAULT_ROOT
const scan = scanFolder(root)

if (process.argv.includes('--dry')) {
  for (const e of scan.evaluations) {
    const t = e.tracker
    console.log([e.material_folder, e.grade || '', t.candidate || e.candidate || '', e.rev != null ? `R.${e.rev}` : 'no file', t.stamp || (e.verdict_line ? 'verdict line' : 'not readable')].join(' | '))
  }
  console.log(`\n${scan.materials.length} materials · ${scan.evaluations.length} evaluations · ${scan.events.length} document folders`)
  process.exit(0)
}

const { serviceClient } = await import('./env.js')
const { supa } = serviceClient()
try {
  const r = await pushScan(supa, scan, arg('--trigger') || 'cli')
  console.log(`Scanned ${r.materials} materials · ${r.evaluations} evaluations · ${r.events_added} new document folders`)
} catch (e) {
  console.error('Scan failed:', e.message || e)
  process.exit(1)
}
