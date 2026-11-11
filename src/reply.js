// The Thai status reply to a PU follow-up that covers several materials
// (golden form, example 6): one numbered section per material, the status
// first with its result word, then only what we are waiting for, with the
// date each item was asked. Pure: rows in, text out. Nothing is sent from here.

const CLOSED = ['approved', 'not_approved', 'closed']
export const DEFAULT_TOPIC = 'ติดตามผลการคัดเลือก'

// 2026-10-28 → 28/10/69 (Thai year, last two digits)
export const thaiDate = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${String((+iso.slice(0, 4) + 543) % 100).padStart(2, '0')}` : ''
// A, B และ C (และตัวอย่าง: no space before a Thai word, as in example 6)
export const thaiList = xs => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} และ${/^[฀-๿]/.test(xs[xs.length - 1]) ? '' : ' '}${xs[xs.length - 1]}`

// Materials as the reply groups them: one per material and grade, candidates under it.
export const groupKey = r => `${r.material.id}|${r.grade || ''}`
export const groupName = r => `${r.materialName}${r.grade ? ` ${r.grade}` : ''}`
export function replyGroups(rows) {
  const by = new Map()
  for (const r of rows) {
    const k = groupKey(r)
    if (!by.has(k)) by.set(k, { key: k, name: groupName(r), rows: [] })
    by.get(k).rows.push(r)
  }
  const list = [...by.values()]
  for (const g of list) {
    g.rows.sort((a, b) => (a.candidate || '').localeCompare(b.candidate || ''))
    g.open = g.rows.some(r => !CLOSED.includes(r.status))
  }
  // Materials still open first, then the closed ones; each by name.
  return list.sort((a, b) => Number(b.open) - Number(a.open) || a.name.localeCompare(b.name))
}

// "Maker ผ่าน Distributor", the way example 6 names a candidate.
const maker = r => r.manufacturer || r.candidate || ''
const via = r => r.supplier && r.supplier !== maker(r) ? r.supplier : null

// A request text logged as "X. After the CoA passes: Y" is two things: X is
// asked now, Y comes later and goes in the one after-CoA clause.
const AFTER = /[.;,]?\s*(?:after the coa passes?|once the coa passes?|หลัง\s*coa\s*ผ่าน(?:จึงจะขอ)?)\s*:?\s*/i
const splitAfter = what => {
  const [now, later] = String(what || '').split(AFTER)
  return { now: now.trim(), later: later?.trim() || null }
}

// A request text that carries its own dates, "(asked 28-10-26)" or "(first asked
// 20-08-26)", reads them in Thai and needs no date added after it.
const ASKED = /\(\s*(first\s+)?asked\s+(\d{2})-(\d{2})-(\d{2})\s*\)/gi
const thaiAsked = s => s.replace(ASKED, (_, first, d, m, y) => `(ขอไว้${first ? 'ครั้งแรก' : ''} ${d}/${m}/${String((2000 + +y + 543) % 100).padStart(2, '0')})`)
const datedAtEnd = s => /\(ขอไว้[^()]*\)\s*$/.test(s)

// รอจาก PU: A, B (ขอไว้ 28/10/69) / C (ขอไว้ 03/11/69); one line per party.
function waiting(reqs) {
  const byParty = new Map()
  for (const q of reqs) {
    const p = q.party || 'PU'
    if (!byParty.has(p)) byParty.set(p, new Map())
    const byDate = byParty.get(p)
    const what = thaiAsked(splitAfter(q.what).now || 'เอกสาร')
    byDate.set(q.event_date, [...(byDate.get(q.event_date) || []), what])
  }
  const dated = ([d, ws]) => { const t = ws.join(', '); return datedAtEnd(t) ? t : `${t} (ขอไว้ ${thaiDate(d)})` }
  return [...byParty].map(([p, byDate]) => `รอจาก ${p}: ${[...byDate].sort((a, b) => a[0].localeCompare(b[0])).map(dated).join(' / ')}`)
}

// Stage words: what passed, what is missing, what failed.
const PASS_TH = { coa: 'CoA', docs: 'GMP', qc: 'ตัวอย่าง QC' }
const GAP_TH = { coa: 'CoA', docs: 'เอกสาร' }
const FAIL_TH = { coa: 'CoA', docs: 'เอกสาร', qc: 'ผลตรวจตัวอย่าง QC' }

// Where a closed Not approved stopped: the red station (recorded or inferred).
const failedAt = r => (r.stations || []).find(s => ['coa', 'docs', 'qc'].includes(s.key) && s.tone === 'red')?.key ?? null

// One candidate: its status sentence, what it waits for, the after-CoA clause.
export function candidateParts(r) {
  const s = r.stages
  const reqs = r.openRequests || []
  if (r.status === 'not_approved') {
    const at = failedAt(r)
    return { status: `${at ? `${FAIL_TH[at]} ` : ''}*ไม่ผ่าน* ปิดการประเมินแล้ว ไม่มีอะไรรอเพิ่ม`, waits: [], after: null, nothingMore: false }
  }
  if (r.status === 'closed') {
    return { status: `ปิดการประเมินแล้ว${r.avlListed === true ? ' (ผู้ผลิตรายนี้อยู่ใน AVL อยู่แล้ว)' : ''} ไม่มีอะไรรอเพิ่ม`, waits: [], after: null, nothingMore: false }
  }
  const waits = waiting(reqs)
  if (r.status === 'approved') {
    const d = r.stageDates?.outcome
    return { status: `ผลการคัดเลือก *อนุมัติ* ลงนามแล้ว${d?.date && !d.est ? `เมื่อ ${thaiDate(d.date)}` : ''}`, waits, after: null, nothingMore: !waits.length }
  }
  // Still open.
  const passed = [], gaps = [], fails = []
  if (s.coa === 'pass') passed.push('coa'); else if (s.coa === 'gap') gaps.push('coa'); else if (s.coa === 'fail') fails.push('coa')
  if (s.docs === 'pass') passed.push('docs'); else if (s.docs === 'gap') gaps.push('docs'); else if (s.docs === 'fail') fails.push('docs')
  if (s.qc === 'approved') passed.push('qc'); else if (s.qc === 'not_approved') fails.push('qc')
  const bits = []
  if (passed.length) bits.push(`${thaiList(passed.map(k => PASS_TH[k]))} *ผ่านแล้ว*`)
  if (gaps.length) bits.push(`${thaiList(gaps.map(k => GAP_TH[k]))} *ขาด*`)
  if (fails.length) bits.push(`${thaiList(fails.map(k => FAIL_TH[k]))} *ไม่ผ่าน*${reqs.length ? ' ตามเอกสารที่ส่งมา' : ''}`)
  // No CoA result recorded: with no file yet RD is still on it; with a file the
  // result exists but isn't in Vetted, so Alex fills it in before sending.
  if (!bits.length && s.coa == null) bits.push(r.status === 'awaiting' ? 'RD กำลังประเมินเอกสาร' : '[ใส่ผลการประเมิน: ยังไม่ได้บันทึกผล CoA ใน Vetted]')
  const toPu = reqs.some(q => !q.party || q.party === 'PU')
  if (fails.length && !reqs.length) bits.push('จะปิดการประเมินเป็นไม่อนุมัติ')
  else if (!fails.length && !gaps.length && passed.length === 3) bits.push('รอลงนามผลการคัดเลือก')
  else if (!fails.length && !gaps.length && passed.length && toPu) bits.push('ยังสรุปผลการคัดเลือกไม่ได้เพราะรอสิ่งที่ขอ PU ไว้')
  if (r.avlListed === true) bits.push('ผู้ผลิตรายนี้อยู่ใน AVL อยู่แล้ว')
  // What follows CoA acceptance, in one clause: from the request text when it
  // spells it out, otherwise the usual set while the CoA hasn't passed yet.
  const later = reqs.map(q => splitAfter(q.what).later).find(Boolean)
  const after = later ? `หลัง CoA ผ่านจึงจะขอ ${later}`
    : s.coa !== 'pass' && s.coa != null && !s.docs && !s.qc && !fails.length && r.avlListed !== true ? 'หลัง CoA ผ่านจึงจะขอ GMP, MSDS และตัวอย่าง' : null
  return { status: bits.filter(Boolean).join(' '), waits, after, nothingMore: false }
}

const NOTHING_MORE = 'ไม่มีเอกสารที่ PU ต้องส่งเพิ่มครับ'

// groups: [{ name, rows }] in the order they go in the message.
export function puReply(groups, { topic = DEFAULT_TOPIC } = {}) {
  const used = groups.filter(g => g.rows.length)
  const out = [`เรื่อง: *ตอบเรื่อง${topic.trim()} ${thaiList(used.map(g => g.name))}*`]
  used.forEach((g, i) => {
    out.push('')
    if (g.rows.length === 1) {
      const r = g.rows[0]
      const p = candidateParts(r)
      const who = [maker(r), via(r) && `ผ่าน ${via(r)}`].filter(Boolean).join(' ')
      out.push(`${i + 1}. ${g.name}${who ? ` (${who})` : ''}`)
      if (p.status) out.push(`- ${p.status}`)
      p.waits.forEach((w, k) => out.push(`- ${w}${k === p.waits.length - 1 && p.after ? ` ${p.after}` : ''}`))
      if (!p.waits.length && p.after) out.push(`- ${p.after}`)
      if (p.nothingMore) out.push(`- ${NOTHING_MORE}`)
    } else {
      out.push(`${i + 1}. ${g.name}`)
      for (const r of g.rows) {
        const p = candidateParts(r)
        const who = `${maker(r) || 'ผู้ผลิตยังไม่ระบุ'}${via(r) ? ` (ผ่าน ${via(r)})` : ''}`
        out.push(`- ${who}: ${[p.status, ...p.waits, p.after, p.nothingMore && NOTHING_MORE].filter(Boolean).join(' ')}`)
      }
    }
  })
  return out.join('\n')
}
