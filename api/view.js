// The manager's view-only link (Vercel function). GET /api/view?t=<token>
// returns everything the app shows, read with the service key here on the
// server, so the browser never holds a key that can write. &doc=<id> returns
// one comparison file. A token that's missing or turned off gets 403.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Vercel project.
import { createClient } from '@supabase/supabase-js'

const must = ({ data, error }) => { if (error) throw error; return data }
async function readAll(build) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const data = must(await build().range(from, from + 999))
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}
const soft = p => p.catch(() => [])

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex')
  const token = String(req.query.t || '')
  if (!/^[\w-]{16,64}$/.test(token)) return res.status(403).json({ error: 'No such link' })
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'The view link is not set up on the server yet' })
  const supa = createClient(url, key, { auth: { persistSession: false } })
  try {
    const share = must(await supa.from('rm_shares').select('token').eq('token', token).is('revoked_at', null).maybeSingle())
    if (!share) return res.status(403).json({ error: 'This link has been turned off' })

    if (req.query.doc) {
      const doc = must(await supa.from('rm_eval_docs').select('body,updated_at').eq('evaluation_id', String(req.query.doc)).maybeSingle())
      return res.status(200).json(doc ?? null)
    }

    const [materials, evaluations, events, runs, products, evidence, files, glossary] = await Promise.all([
      readAll(() => supa.from('rm_materials').select('*').is('removed_at', null).order('folder')),
      readAll(() => supa.from('rm_evaluations').select('*').is('removed_at', null).order('folder')),
      readAll(() => supa.from('rm_events').select('*').order('event_date').order('created_at')),
      supa.from('rm_scan_runs').select('*').order('started_at', { ascending: false }).limit(1).then(must),
      soft(readAll(() => supa.from('rm_products').select('*').order('name'))),
      soft(readAll(() => supa.from('rm_evidence').select('*').order('created_at'))),
      soft(readAll(() => supa.from('rm_files').select('*').order('doc_date'))),
      soft(readAll(() => supa.from('rm_glossary').select('thai,english'))),
    ])
    // Short-lived links for the evidence images and the uploaded scans.
    const urls = {}
    const sign = async (bucket, paths, prefix) => {
      for (let i = 0; i < paths.length; i += 100) {
        const { data } = await supa.storage.from(bucket).createSignedUrls(paths.slice(i, i + 100), 3600)
        for (const x of data || []) if (x.signedUrl) urls[prefix + x.path] = x.signedUrl
      }
    }
    await Promise.all([
      sign('rm-evidence', evidence.map(x => x.path), ''),
      sign('rm-files', files.filter(f => f.path).map(f => f.path), 'files/'),
    ])
    // created_by ids are no use to a viewer
    const clean = rows => rows.map(({ created_by, ...r }) => r)
    return res.status(200).json({
      data: { materials, evaluations, events: clean(events), products, evidence: clean(evidence), files, lastRun: runs[0] ?? null },
      glossary: Object.fromEntries(glossary.map(g => [g.thai, g.english])),
      urls,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
