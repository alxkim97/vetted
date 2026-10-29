// Turns a comparison .md file into sections, tables and text for the full
// evaluation page, and marks which rows and cells need attention. Pure, no fs
// (tested in test/doc.test.js).

// ── English ──────────────────────────────────────────────────────────────
// Form vocabulary from FR-QA-PC-069 and the 3-tier stamp. Company and person
// names live in the rm_glossary table instead (this repo is public).
export const BUILTIN_GLOSSARY = {
  'ผู้อนุมัติ': 'Approver', 'ผู้ประเมิน': 'Evaluator', 'ผู้จัดการฝ่าย': 'Department Manager',
  'ไม่ผ่าน': 'Fail', 'ผ่าน': 'Pass', 'ขาด': 'Missing', 'ไม่อนุมัติ': 'Not Approved', 'อนุมัติ': 'Approved',
  'ผลการตรวจสอบ': 'Inspection result', 'ใบเสนอราคา': 'Quotation', 'ผู้ผลิต': 'Manufacturer', 'ผู้จัดจำหน่าย': 'Distributor',
  'เปลี่ยนแปลง': 'Change', 'เพิ่ม แหล่งผลิตวัตถุดิบ': 'add raw-material source', 'เพิ่ม แหล่งผลิต': 'add source', 'เพิ่มแหล่งผลิต': 'add source',
  'ตัวอย่างสำหรับทดลอง': 'Trial sample', 'เพื่อใช้ในการทดลอง': 'For trial use', 'ขอเอกสารเพิ่มเติม': 'Request additional documents',
  'ขอตัวอย่างซ้ำนับทดลอง ส่งวิเคราะห์': 'Request a repeat trial sample, send for analysis',
  'จากผู้ผลิต ตามรายชื่อที่อ้างอิง': 'from the manufacturer, per the referenced list',
  'ไม่ระบุ': 'not stated', 'ไม่ครบ': 'incomplete', 'ไม่มี': 'no', 'มี': 'has', 'ถือว่าไม่ใช่': 'not considered', 'เป็น': 'is',
  'กว้างกว่า': 'wider than', 'ต่างจาก': 'differs from', 'เดิม': 'original', 'อื่น ๆ': 'Other', 'ยกเลิก': 'Cancel',
  'ต่ออายุ': 'renewal', 'ออกโดย': 'Issued by', 'ครั้งที่': 'No.', 'เคยพบ': 'previously found', 'ราคานี้มีผลทันที': 'price effective immediately',
  'ตาม': 'per', 'ตัวยาไม่': 'substance is not', 'แต่ต้องทำ': 'but must do', 'เพื่อดูว่า': 'to see whether', 'เปลี่ยนแปลง วัส': 'changes in the',
  'หรือไม่ เนื่องจาก': 'or not, because', 'ตามที่ทาง': 'as', 'ทำขอผ่อนผัน': 'requested a waiver', 'ทาง': 'the',
  'แจ้งว่า พบว่า ไม่มีตัวข้อบันทึกฯ': 'reported that no such record exists', 'ใช้โกร่ง บด': 'ground in a mortar',
  'หัวข้อ': 'Item', 'ไม่ทวนความ': 'not restated per', 'ตามที่ชี้แจง': 'as explained', 'ผลิต': 'production', 'แหล่ง': 'source',
  'จำกัด': 'Co., Ltd.', 'บจก': 'Co.', 'บ': 'baht', 'พ.ย': 'Nov',
}

// Runs of Thai letters (not the baht sign), allowing spaces, dots and brackets inside.
const TH = 'ก-ฺเ-๛'
const THAI_RUN = new RegExp(`[${TH}][${TH}\\s().]*[${TH}]|[${TH}]`, 'g')
export const hasThai = s => new RegExp(`[${TH}]`).test(s)

// Whole runs first, then each space-separated word of the run. Thai has no
// spaces inside words, so nothing is replaced inside a longer word.
// "ผู้ประเมิน (evaluator)" → "Evaluator (evaluator)" → "Evaluator".
export function toEnglish(text, glossary = {}) {
  const dict = { ...BUILTIN_GLOSSARY, ...glossary }
  let out = String(text ?? '').replace(THAI_RUN, run => dict[run] ?? run.split(/(\s+)/).map(w => dict[w] ?? w).join(''))
  // collapse a translation followed by its own gloss, then tidy punctuation
  out = out.replace(/\b([A-Za-z][\w ,.&/-]{0,60}?)\s+\((\1)\)/gi, '$1')
  return out.replace(/\.\.(?!\.)/g, '.').replace(/ {2,}/g, ' ')
}

// ── Markdown → blocks ───────────────────────────────────────────────────
const splitRow = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l ?? '')

export const SECTION_KINDS = [
  ['sources', /^sources?\b/i], ['part1', /^part\s*1\b/i], ['part2', /^part\s*2\b/i],
  ['additional', /^additional tests?\b/i], ['notes', /^notes?\b/i], ['verdict', /^overall verdict/i],
  ['docs', /^supporting documents/i],
]
const kindOf = h => SECTION_KINDS.find(([, re]) => re.test(h.replace(/\*\*/g, '').trim()))?.[0] ?? 'other'

export function parseDoc(md) {
  const lines = String(md ?? '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)
  const sections = [{ kind: 'header', heading: 'File header', blocks: [] }]
  let title = null
  const cur = () => sections[sections.length - 1]
  const push = b => cur().blocks.push(b)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const t = l.trim()
    if (!t || /^<\/?(div|img|br|p)\b[^>]*>\s*(<\/div>)?$/i.test(t) || /^(-{3,}|\*{3,}|_{3,})$/.test(t)) continue
    const h = t.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      if (h[1].length === 1 && !title) { title = h[2]; continue }
      if (h[1].length <= 2) sections.push({ kind: kindOf(h[2]), heading: h[2], blocks: [] })
      else push({ type: 'h', text: h[2] })
      continue
    }
    if (t.startsWith('```')) {
      const body = []
      while (++i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i])
      push({ type: 'code', text: body.join('\n') })
      continue
    }
    if (t.startsWith('|') && isSep(lines[i + 1])) {
      const head = splitRow(t)
      const rows = []
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(splitRow(lines[i]))
      i--
      push(tableBlock(head, rows))
      continue
    }
    const li = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
    if (li) {
      const last = cur().blocks[cur().blocks.length - 1]
      const item = li[3]
      if (last?.type === 'list') last.items.push(item)
      else push({ type: 'list', ordered: /\d/.test(li[2]), items: [item] })
      continue
    }
    if (t.startsWith('>')) {
      const last = cur().blocks[cur().blocks.length - 1]
      const text = t.replace(/^>\s?/, '')
      if (last?.type === 'quote') last.text += '\n' + text
      else push({ type: 'quote', text })
      continue
    }
    // continuation of a list item (indented) or of a paragraph
    const last = cur().blocks[cur().blocks.length - 1]
    if (/^\s{2,}/.test(l) && last?.type === 'list') { last.items[last.items.length - 1] += ' ' + t; continue }
    if (last?.type === 'p' && lines[i - 1]?.trim()) { last.text += ' ' + t; continue }
    push({ type: 'p', text: t })
  }
  if (!sections[0].blocks.length) sections.shift()
  return { title, sections }
}

// ── What needs attention ────────────────────────────────────────────────
// Worst first. "Pass (incumbent). Missing for candidate" reads as missing.
export const TONES = ['fail', 'missing', 'confirm', 'pending', 'pass', 'na']
const TONE_WORDS = [
  ['fail', /\bfail(s|ed)?\b|ไม่ผ่าน|\bdiscontinue|\bnot approved\b|ไม่อนุมัติ/],
  ['missing', /\bmissing\b|ขาด|\bnot (reported|submitted|tested|provided|received|stated|on file)\b|\bdoes not exist\b|\bnot yet pass/],
  ['confirm', /\bconfirm\b|\bexpired?\b|\bexpiring\b|\bneeds update\b|\(!\)/],
  ['pending', /\bpending\b|\brequested\b|\bunder qa review\b|^open\b/],
  ['pass', /\bpass(es|ed)?\b|ผ่าน|\bon file\b|\breceived\b|\bpresent\b|^done\b|\bmatch\b|\bcomplies\b|\bapproved\b|อนุมัติ|\bavailable\b/],
  ['na', /^n\/a\b|\bnot applicable\b|\bnot required\b|^closed\b|^\(not applicable/],
]
export const plain = s => String(s ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/\*\*|__|`/g, '').replace(/\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim()

// Tone of a verdict/status cell, read from its opening words. "Pass for
// candidate; Fail for the incumbent's result" is the candidate's Pass.
export function toneOf(cell) {
  let s = plain(cell).toLowerCase().slice(0, 60)
  if (!s) return null
  const forCand = s.match(/^(.*?)\bfor (the )?candidate\b/)
  if (forCand?.[1].trim()) s = forCand[1]
  const found = TONE_WORDS.filter(([, re]) => re.test(s)).map(([t]) => t)
  return found.length ? TONES.find(t => found.includes(t)) : null
}

// A data cell that says the value isn't there.
const GAP_CELL = /^(not reported|not stated|not tested|not provided|not submitted|missing|no result|not on coa)\b/i
export const cellGap = cell => GAP_CELL.test(plain(cell)) || /\(!\)/.test(cell)

const VERDICT_COL = /^(verdict|status|result)\b/i
function tableBlock(head, rows) {
  const vi = head.findIndex(h => VERDICT_COL.test(plain(h)))
  // a count table ("Status | Count") carries no row verdicts
  const isCount = head.some(h => /^count\b/i.test(plain(h)))
  return {
    type: 'table', head, rows,
    verdictCol: vi,
    tones: rows.map(r => vi >= 0 ? toneOf(r[vi]) : null),
    isCount,
  }
}

// One line on why a row is flagged: the verdict's own explanation when it has
// one ("Fail — spec wider than USP"), else the reference limit and the
// candidate's result side by side, else the row's notes.
function detailOf(b, r, first) {
  const v = plain(r[b.verdictCol]).replace(/\s*\(notes?[^)]*\)\s*/gi, ' ').trim()
  const rest = v.replace(/^[\w/ -]{0,25}?\b(pass|fail|missing|confirm)(\/\w+)?\b[.:,—–-]*\s*/i, '').trim()
  if (rest.length > 3 && rest !== v) return rest.startsWith('(') ? v : rest
  const ref = b.head.findIndex((h, i) => i > first && /reference|criteria|usp|bp|ep/i.test(plain(h)))
  const cand = b.verdictCol - 1
  if (ref > 0 && cand > ref) return `${plain(b.head[ref]).replace(/\s*\(.*\)$/, '')}: ${plain(r[ref])} · ${plain(b.head[cand]).replace(/\s*\(.*\)$/, '')}: ${plain(r[cand])}`
  const other = r.map((c, i) => i !== first && i !== b.verdictCol ? plain(c) : '').filter(c => c && c !== '—' && c !== '-')
  return other.join(' · ') || v
}

// Rows across the file that need a look, in file order.
export function issuesOf(doc) {
  const out = []
  doc.sections.forEach((sec, si) => sec.blocks.forEach((b, bi) => {
    if (b.type !== 'table' || b.verdictCol < 0 || b.isCount) return
    b.rows.forEach((r, ri) => {
      const tone = b.tones[ri]
      if (!['fail', 'missing', 'confirm'].includes(tone)) return
      const first = b.head[0]?.trim() === '#' ? 1 : 0
      out.push({ tone, section: sec, label: plain(r[first]), text: detailOf(b, r, first), anchor: `r-${si}-${bi}-${ri}` })
    })
  }))
  return out
}

// "Document | Status | Notes", wherever the file puts it.
export const isDocTable = b => /^document\b/i.test(plain(b.head[0]))

// Pass/Confirm/Missing/Fail counts from the comparison table (Part 2), or from
// every verdict table when the file has no Part 2.
export function tally(doc) {
  const tables = doc.sections.filter(s => s.kind === 'part2').flatMap(s => s.blocks).filter(b => b.type === 'table' && b.verdictCol >= 0)
  const all = doc.sections.flatMap(s => s.blocks).filter(b => b.type === 'table' && b.verdictCol >= 0 && !b.isCount)
  const docs = all.filter(isDocTable)
  const use = tables.length ? tables : all.filter(b => !isDocTable(b))
  const counts = { fail: 0, missing: 0, confirm: 0, pass: 0 }
  for (const b of use) for (const t of b.tones) if (t in counts) counts[t]++
  counts.docsMissing = docs.reduce((n, b) => n + b.tones.filter(t => t === 'missing' || t === 'fail').length, 0)
  return counts
}
