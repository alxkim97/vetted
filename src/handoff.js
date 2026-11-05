// Text Alex copies out of an evaluation: the starter prompt for a fresh
// per-material chat (the /rm-eval-handoff template) and the Thai result
// message to PU (the golden form). Pure: row + parsed file in, text out.
import { productNames, fmtDate } from './model.js'
import { plain, tally, issuesOf } from '../lib/doc.js'

export const DEFAULT_ROOT = 'C:\\Users\\RDAlex2\\Desktop\\Everything\\APm Drug Files\\General\\Raw Material Evaluation Document'

// Lines the comparison file states in its header.
export function facts(body) {
  if (!body) return {}
  const line = label => body.match(new RegExp(`\\*\\*${label}[^*]*:\\*\\*\\s*(.+)`, 'i'))?.[1] ?? null
  const op = line('Operative reference') || body.match(/\|\s*\*\*Operative reference\*\*\s*\|\s*([^|\n]+)/i)?.[1] || null
  const opSection = op ? body.slice(body.indexOf(op), body.indexOf(op) + 1600) : ''
  // The bold or code part names the reference ("BP 2024", "SD-QC-001-2000002 (R0)").
  const ref = op ? plain(op.match(/\*\*([^*]+)\*\*/)?.[1] || op.match(/`([^`]+)`/)?.[1] || op.split(/[,.;:]/)[0]) : null
  const spec = opSection.match(/SD-QC-\d{3}-\d{7}\s*\(?R\d+\)?/)?.[0]?.replace(/\s*\((R\d+)\)/, ' $1').replace(/\s+/, ' ') ?? null
  const cand = line('Candidate edition')
  const candEdition = cand?.match(/cites\s+"([^"]+)"/i)?.[1] ?? null
  const price = body.match(/฿\s?([\d,]+(?:\.\d+)?)\s*\/\s*kg/i)?.[1] || body.match(/([\d,]+(?:\.\d+)?)\s*(?:baht|บาท|THB)\s*(?:\/|per)\s*kg/i)?.[1] || null
  return { opLine: op ? plain(op).replace(/\s+/g, ' ').trim().replace(/[:;,]$/, '') : null, ref, spec, candEdition, price }
}

// Revision numbers: "R.2" → next "R.3".
const nextRev = rev => rev == null ? 'R.0' : `R.${rev + 1}`

// Starter prompt for a fresh chat. With a comparison file: a new candidate (or
// the next revision) on an existing evaluation. Without: a first evaluation.
export function chatPrompt(r, { body, root = DEFAULT_ROOT, siblings = [] } = {}) {
  const f = facts(body)
  const mat = r.materialName
  const docs = r.events.filter(x => x.kind === 'docs_received')
  const newest = docs[docs.length - 1]
  const docFolders = [...new Set(docs.map(x => x.source_ref?.split('/').pop()).filter(Boolean))]
  const scanFile = newest?.what?.replace(/^\d+ files?: /, '').split('; ')[0] || 'to be confirmed from the scan'
  const earlier = siblings.filter(x => x.id !== r.id).map(x => `${x.candidate || 'candidate not set'} (${x.statusLabel})`)
  const first = !r.fileName && !earlier.length
  const candidate = r.candidate || 'to be confirmed from the scan'
  const lines = [
    `${first ? 'Starting' : 'Continuing'} raw material evaluation for ${mat} at APm${first ? ', first evaluation of this material' : ', with a new candidate'}. Fresh dedicated chat per the project's multi-chat workflow. Use the \`rm-eval\` skill for the checks below.`,
    '',
    'Read first:',
    `- ${root}\\CLAUDE.md (mandatory format rules)`,
    `- ${mat}\\ folder${r.fileName ? `, especially the existing comparison file (${r.fileName})` : ''}, Old\\, References\\, and Document\\ (${docFolders.length ? docFolders.join(', ') : 'no dated folders yet'}).`,
    '',
    `New scan, in ${r.folder.replace(/\//g, '\\')}\\Document\\${newest?.source_ref?.split('/').pop() ?? '<YYMMDD>'}\\:`,
    `- ${scanFile}. Candidate: ${candidate}${r.manufacturer && r.manufacturer !== r.candidate ? `, manufacturer ${r.manufacturer}` : ''}, via ${r.supplier || 'distributor to be confirmed'}. Form date, ticked boxes, quoted price and reason: to be confirmed from the scan. ${f.price ? `Quotation seen in the file: ${f.price} baht/kg.` : ''}`.trim(),
    '',
    'Things to check carefully:',
    first
      ? '- This is the first evaluation of this material: set the operative reference from APm\'s own spec (SD-QC, item-coded) or the latest APm CoA (FR-QC-PC-068) before Part 1.'
      : `- ${earlier.length ? `Earlier candidates (${earlier.join('; ')}) were reviewed. Don't reopen them, but reuse the same operative reference and the same Part 1 / incumbent columns.` : 'Reuse the operative reference and the Part 1 / incumbent columns of the existing file.'}`,
    `- Operative reference: ${f.opLine || 'to be confirmed from the existing file'}. Check whether a current compendium edition now has a monograph (or has removed a test) and flag it.`,
    '- Spec-level Fail rule: if the candidate\'s own stated spec is wider than the operative reference, it is a Fail even if the batch result complies.',
    `- Compare the price${f.price ? ` (${f.price} baht/kg)` : ''} with the incumbent's cost and with the earlier candidates' quotations.`,
    `- Check the PQR log and the AVL for ${r.manufacturer || r.candidate || 'the manufacturer (to be confirmed from the scan)'}.`,
    '',
    `Don't build ${r.fileName ? nextRev(r.rev) : 'the comparison file'} yet. First:`,
    '(1) read the scan and tell me what it contains (CoA batch, spec, tests, results);',
    r.fileName ? `(2) tell me how it lines up against the existing R.${r.rev} file;` : '(2) tell me which reference the comparison should use and why;',
    '(3) tell me what\'s still missing (GMP, MSDS, sample, impurity methods, etc.).',
    `Build ${r.fileName ? `the revised comparison only after I confirm. Revision numbering: this becomes ${nextRev(r.rev)} in the same folder, with R.${r.rev} moved to Old\\.` : 'the comparison file only after I confirm; it starts at R.0.'} Use ครับ in any Thai drafts.`,
    'After the build, follow "What To Do At Each Step" in CLAUDE.md: tracker block with the stage lines (coa, plus avl/docs/qc/outcome as reached), log the verdict in Vetted, draft the manager update message, and log it once I\'ve sent it.',
  ]
  return lines.join('\n')
}

const RESULT_TH = { pass: 'ผ่าน', gap: 'ขาด', fail: 'ไม่ผ่าน' }

// What PU still has to send, from the stages and the file's flagged rows.
export function asksFor(r, doc) {
  const s = r.stages
  const asks = []
  const issues = doc ? issuesOf(doc) : []
  const part2 = issues.filter(x => x.section.kind === 'part2' && (x.tone === 'missing' || x.tone === 'confirm'))
  // Documents the supplier sends; APm's own papers (its spec, its CoA) aren't PU's to fetch.
  const docGaps = issues.filter(x => x.section.kind === 'docs' && !/\bAPm\b/.test(x.label))
  const list = xs => [...new Set(xs.map(x => x.label))].join(', ')
  if (s.coa === 'gap' && part2.length) asks.push(`ข้อมูลใน CoA ที่ยังขาด: ${list(part2)}`)
  else if (s.coa === 'gap' && docGaps.length) asks.push(`เอกสารที่ยังขาด: ${list(docGaps)}`)
  else if (s.coa === 'gap') asks.push('ข้อมูลใน CoA ที่ยังขาด (ตามไฟล์ประเมิน)')
  if (s.coa === 'pass' && s.docs !== 'pass') {
    if (s.docs === 'gap' && docGaps.length) asks.push(`เอกสารที่ยังขาด: ${[...new Set(docGaps.map(x => x.label))].join(', ')}`)
    else asks.push('เอกสาร GMP')
  }
  if (s.coa === 'pass' && !s.qc) asks.push('ตัวอย่างสำหรับ QC')
  return asks
}

// Thai result message to PU in the golden form (rm_eval_pu_message_golden_form).
export function puMessage(r, { body, doc, link } = {}) {
  const f = facts(body)
  const t = doc ? tally(doc) : null
  const total = t ? t.pass + t.fail + t.missing + t.confirm : 0
  const products = productNames(r.products)
  const maker = r.manufacturer || r.candidate || ''
  const head = `เรื่อง: ลดต้นทุนสารตั้งต้น - ${r.materialName}${r.grade ? ` ${r.grade}` : ''} (${[r.itemCode, products.join(' / ')].filter(Boolean).join(', ')}) แหล่งใหม่: ${maker}`
  const word = RESULT_TH[r.stages.coa]
  let result
  if (!word) result = 'RD ประเมินเอกสารแล้วครับ'
  else if (r.stages.coa === 'pass') result = `*RD ประเมินเอกสารแล้วครับ ผลเป็น ผ่าน ${t && total ? `ทุกหัวข้อ (${t.pass}/${total})` : ''}*`.replace(' *', '*')
  else if (r.stages.coa === 'gap') {
    // Every CoA test can pass while the documents are what's missing.
    const gaps = t ? t.missing + t.confirm : 0
    result = gaps
      ? `*RD ประเมินเอกสารแล้วครับ ผลเป็น ขาด (ผ่าน ${t.pass}/${total} หัวข้อ, ขาดข้อมูล ${gaps} หัวข้อ)*`
      : `*RD ประเมินเอกสารแล้วครับ ผลเป็น ขาด: CoA ผ่านทุกหัวข้อ${total ? ` (${t.pass}/${total})` : ''} แต่เอกสารยังไม่ครบ*`
  }
  else result = `*RD ประเมินเอกสารแล้วครับ ผลเป็น ไม่ผ่าน${t?.fail ? ` (ไม่ผ่าน ${t.fail} หัวข้อ)` : ''}*`
  const source = `${maker}${r.supplier && r.supplier !== maker ? ` (ผ่าน ${r.supplier})` : ''}${f.price ? ` ฿${f.price}/kg` : ''}`
  const out = [head, '', result, '', source]
  if (r.stages.avl === true) out.push('', `*ผู้ผลิตรายนี้ อยู่ใน AVL ของ ${r.itemCode || r.materialName} อยู่แล้ว*`)
  if (f.ref) {
    out.push('', 'มาตรฐานที่ใช้:', `- ${f.ref} = มาตรฐานหลัก${f.spec && !f.ref.includes(f.spec) ? ` ตาม spec APm (${f.spec})` : /^SD-QC/.test(f.ref) ? ' (spec ของ APm)' : ''}`)
    if (f.candEdition) out.push(`- ${f.candEdition} = ฉบับที่ CoA ของ ${maker} อ้าง`)
  }
  const asks = asksFor(r, doc)
  if (asks.length) out.push('', 'PU: ขอเพิ่มดังนี้ครับ', ...asks.map(a => `- ${a}`))
  if (link) out.push('', `ดูรายละเอียด: ${link}`)
  return { text: out.join('\n'), asks, summary: `${r.stages.coa ? `CoA ${{ pass: 'Pass', gap: 'Missing', fail: 'Fail' }[r.stages.coa]}` : 'Result'} sent to PU${asks.length ? `; asked for ${asks.length} item${asks.length > 1 ? 's' : ''}` : ''} (${fmtDate(new Date().toISOString().slice(0, 10))})` }
}
