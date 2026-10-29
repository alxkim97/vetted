// The full evaluation: the comparison file as spreadsheet-style tables, with
// Fail / Missing / Confirm rows and empty result cells marked, all in English.
import { state } from '../store.js'
import { STATUS, fmtDate, productNames } from '../model.js'
import { esc, icon } from '../ui.js'
import { parseDoc, issuesOf, tally, toEnglish, cellGap, plain } from '../../lib/doc.js'

const TONE_LABEL = { fail: 'Fail', missing: 'Missing', confirm: 'Confirm', pending: 'Pending', pass: 'Pass', na: 'N/A' }
const FLAGGED = ['fail', 'missing', 'confirm']
// Sections that start folded: long reference material, not the findings.
const FOLDED = ['header', 'sources', 'notes']
const SECTION_TITLE = { header: 'File header and revision notes' }

// Bold, italics, code and line breaks; "Note 4" links to that note.
function md(s, { notes = true } = {}) {
  let h = esc(s)
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  if (notes) h = h.replace(/\bNote (\d+[a-z]?)\b/g, '<button class="note-ref" data-act="note" data-value="$1">Note $1</button>')
  return h
}

// The parsed file for an id, translated with the current glossary.
function docFor(id) {
  const entry = state.docs[id]
  if (!entry?.body) return null
  if (!entry.parsed) entry.parsed = parseDoc(toEnglish(entry.body, state.glossary || {}))
  return entry.parsed
}

const colLetter = i => String.fromCharCode(65 + i)

function grid(b, si, bi) {
  const ownNum = plain(b.head[0]) === '#'
  const cols = b.head.map((h, ci) => ci).filter(ci => !(ownNum && ci === 0))
  const issuesOnly = state.prefs.issuesOnly
  const flagged = (r, ri) => FLAGGED.includes(b.tones[ri]) || r.some((c, ci) => ci !== b.verdictCol && cellGap(c))
  const rows = b.rows.map((r, ri) => ({ r, ri })).filter(({ r, ri }) => !issuesOnly || flagged(r, ri))
  if (!rows.length) return issuesOnly ? `<p class="xl-none">${icon('check', 15)} Nothing flagged in this table.</p>` : ''
  return `
    <div class="xl-wrap"><table class="xl">
      <thead>
        <tr class="xl-letters"><th class="xl-corner"></th>${cols.map((ci, k) => `<th>${colLetter(k)}</th>`).join('')}</tr>
        <tr class="xl-head"><th class="xl-rn">${ownNum ? '#' : ''}</th>${cols.map(ci => `<th class="${ci === b.verdictCol ? 'xl-v' : ''}">${md(b.head[ci], { notes: false })}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rows.map(({ r, ri }) => {
          const tone = b.tones[ri]
          return `<tr id="r-${si}-${bi}-${ri}" class="${tone ? `t-${tone}` : ''}">
            <th class="xl-rn" title="${tone ? TONE_LABEL[tone] : ''}">${esc(ownNum ? plain(r[0]) : ri + 1)}</th>
            ${cols.map(ci => {
              const cls = [ci === b.verdictCol ? 'xl-v' : '', ci !== b.verdictCol && cellGap(r[ci] ?? '') ? 'xl-gap' : ''].filter(Boolean).join(' ')
              return `<td class="${cls}">${md(r[ci] ?? '')}</td>`
            }).join('')}
          </tr>`
        }).join('')}
      </tbody>
    </table></div>
    ${issuesOnly && rows.length < b.rows.length ? `<p class="xl-count">${rows.length} of ${b.rows.length} rows shown</p>` : ''}`
}

const noteId = text => plain(text).match(/^Note (\d+[a-z]?)\b/)?.[1]

function block(b, si, bi, sec) {
  switch (b.type) {
    case 'table': return grid(b, si, bi)
    case 'h': return `<h4 class="fe-sub">${md(b.text)}</h4>`
    case 'quote': return `<blockquote class="fe-quote">${md(b.text).replace(/\n/g, '<br>')}</blockquote>`
    case 'code': return `<pre class="fe-code">${esc(b.text)}</pre>`
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul'
      return `<${tag} class="fe-list">${b.items.map((it, k) => {
        const n = sec.kind === 'notes' ? noteId(it) ?? (b.ordered ? String(k + 1) : null) : null
        return `<li${n ? ` id="note-${esc(n)}"` : ''}>${md(it)}</li>`
      }).join('')}</${tag}>`
    }
    default: {
      const n = sec.kind === 'notes' ? noteId(b.text) : null
      return `<p class="fe-p"${n ? ` id="note-${esc(n)}"` : ''}>${md(b.text)}</p>`
    }
  }
}

function section(sec, si, issues) {
  const mine = issues.filter(x => x.section === sec)
  const counts = FLAGGED.map(t => [t, mine.filter(x => x.tone === t).length]).filter(([, n]) => n)
  const title = SECTION_TITLE[sec.kind] || sec.heading.replace(/\*\*/g, '')
  const body = sec.blocks.map((b, bi) => block(b, si, bi, sec)).join('')
  const key = `${state.evalId}:${si}`
  const open = state.secOpen.has(key) ? state.secOpen.get(key) : !FOLDED.includes(sec.kind)
  return `
    <details class="fe-sec k-${sec.kind}" data-sec="${si}"${open ? ' open' : ''}>
      <summary><h2>${md(title, { notes: false })}</h2>
        ${counts.map(([t, n]) => `<span class="tchip t-${t}">${n} ${TONE_LABEL[t]}</span>`).join('')}
        <span class="fe-chev">${icon('right', 18)}</span></summary>
      <div class="fe-body">${body || '<p class="fe-p muted">Empty section.</p>'}</div>
    </details>`
}

export function renderEvaluation() {
  const r = state.rows.find(x => x.id === state.evalId)
  if (!r) return `<div class="fe-empty"><p>This evaluation is no longer in the register.</p><button class="btn soft" data-act="back">${icon('left', 16)} Back</button></div>`
  const entry = state.docs[r.id]
  const doc = docFor(r.id)
  const t = doc ? tally(doc) : null
  const issues = doc ? issuesOf(doc) : []
  const en = s => toEnglish(s, state.glossary || {})
  const products = productNames(r.products)
  const isDesktop = !!window.electronAPI?.isElectron
  // The whole verdict paragraph from the file; the register keeps a shortened copy.
  const fullVerdict = doc?.sections.find(s => s.kind === 'verdict')?.blocks.find(b => b.type === 'p' || b.type === 'quote')?.text
  const verdict = fullVerdict || (r.verdictLine && en(r.verdictLine))

  const head = `
    <div class="fe-top">
      <button class="pill" data-act="back">${icon('left', 16)}<span>${esc({ register: 'Register', materials: 'Materials', waiting: 'Waiting', home: 'Home' }[state.backView] || 'Back')}</span></button>
      <div class="fe-actions">
        ${isDesktop && r.fileName ? `<button class="btn soft small" data-act="eval-file">${icon('file', 15)} Open file</button>` : ''}
        <button class="btn soft small" data-act="eval-detail">${icon('clock', 15)} Timeline and stamp</button>
      </div>
    </div>
    <header class="fe-head">
      <p class="eyebrow">${esc([r.materialName, r.grade].filter(Boolean).join(' · '))}</p>
      <div class="fe-title"><h1>${r.candidate ? esc(r.candidate) : 'Candidate not set'}</h1><span class="stamp big t-${STATUS[r.status].tone}">${esc(STATUS[r.status].label)}</span></div>
      <div class="fe-meta">
        ${r.rev != null ? `<span>R.${r.rev} · ${fmtDate(r.revDate)}</span>` : ''}
        ${r.itemCode ? `<span class="mono">${esc(r.itemCode)}</span>` : ''}
        ${r.manufacturer ? `<span>${esc(r.manufacturer)}${r.supplier && r.supplier !== r.manufacturer ? ` via ${esc(r.supplier)}` : ''}</span>` : ''}
        ${products.length ? `<span class="chips">${products.map(p => `<span class="chip-tag">${esc(p)}</span>`).join('')}</span>` : ''}
      </div>
      ${verdict ? `<blockquote class="verdict">${md(verdict)}</blockquote>` : ''}
    </header>`

  if (!entry) return head + `<div class="fe-empty">${icon('sync', 18)} Loading the comparison file…</div>`
  if (entry.error) return head + `<div class="fe-empty"><b>The comparison file couldn't be loaded.</b><p>${esc(entry.error)}</p></div>`
  if (!doc) return head + `<div class="fe-empty"><b>No comparison file scanned for this evaluation yet.</b><p>${r.fileName ? 'Run a scan (desktop Re-scan or the 08:30 task) to load it.' : 'The documents are in, but nobody has written the comparison file.'}</p></div>`

  const tiles = [['fail', t.fail], ['missing', t.missing], ['confirm', t.confirm], ['pass', t.pass]]
  const firstOf = tone => issues.find(x => x.tone === tone)?.anchor
  return `${head}
    <section class="fe-summary">
      <div class="fe-tiles">
        ${tiles.map(([tone, n]) => `<button class="fe-tile t-${tone}${n ? '' : ' zero'}" ${n && tone !== 'pass' && firstOf(tone) ? `data-act="jump" data-value="${firstOf(tone)}"` : 'disabled'}><b>${n}</b><span>${TONE_LABEL[tone]}</span></button>`).join('')}
        <button class="fe-tile docs${t.docsMissing ? ' t-missing' : ' zero'}" ${t.docsMissing ? `data-act="jump" data-value="${issues.find(x => x.section.kind === 'docs' || /^document/i.test(x.section.heading))?.anchor ?? ''}"` : 'disabled'}><b>${t.docsMissing}</b><span>Documents missing</span></button>
      </div>
      <div class="seg" role="group" aria-label="Rows">
        <button type="button" class="${state.prefs.issuesOnly ? '' : 'on'}" data-act="issues-only" data-value="0">All rows</button>
        <button type="button" class="${state.prefs.issuesOnly ? 'on' : ''}" data-act="issues-only" data-value="1">Flagged only</button>
      </div>
    </section>
    ${issues.length ? `
    <section class="fe-attn">
      <h2>Needs attention <span class="muted">${issues.length}</span></h2>
      <div class="attn-list">
        ${issues.map(x => `<button class="attn t-${x.tone}" data-act="jump" data-value="${x.anchor}">
          <span class="tchip t-${x.tone}">${TONE_LABEL[x.tone]}</span>
          <span class="attn-main"><b>${esc(x.label)}</b><span>${esc(x.text.length > 150 ? x.text.slice(0, 147) + '…' : x.text)}</span></span>
          <span class="attn-sec">${esc(x.section.heading.replace(/\*\*/g, '').replace(/\s*[—–(].*$/, ''))}</span>
        </button>`).join('')}
      </div>
    </section>` : `<section class="fe-attn clear">${icon('check', 18)} Nothing flagged in this file.</section>`}
    <div class="fe-sections">${doc.sections.map((s, si) => section(s, si, issues)).join('')}</div>
    <p class="foot-note">${esc(r.fileName || '')} · scanned ${entry.at ? fmtDate(entry.at.slice(0, 10)) : ''}. Rows are marked from the Verdict or Status column; amber cells say a result was not reported.</p>`
}
