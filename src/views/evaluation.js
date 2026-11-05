// One page per evaluation: status, the station line (AVL → CoA → Docs → QC
// sample → Decision), who has it now, then Summary / Comparison / Timeline /
// Documents. Everything is edited here; a view link shows the same page read-only.
import { state, readOnly } from '../store.js'
import { STATUS, STAGES, OUTCOMES, EVENT_KINDS, STATIONS, fmtDate, todayIso, waitTone, productNames, daysBetween } from '../model.js'
import { esc, icon, openModal, toast, confirmBox, openMenu, closeMenu, copyText } from '../ui.js'
import { pill, viewLink, evalHash } from '../parts.js'
import { parseDoc, issuesOf, tally, toEnglish, cellGap, plain } from '../../lib/doc.js'
import { stampToStages } from '../../lib/parse.js'
import { COLUMN, setStage, saveFields, addEntry, deleteEntry, addImages, deleteImage, logSent } from '../edits.js'
import { evidenceUrls, fileUrl } from '../data.js'
import { chatPrompt, puMessage, facts, DEFAULT_ROOT } from '../handoff.js'
import { printEvaluation } from '../print.js'

const isDesktop = () => !!window.electronAPI?.isElectron
const TONE_LABEL = { fail: 'Fail', missing: 'Missing', confirm: 'Confirm', pending: 'Pending', pass: 'Pass', na: 'N/A' }
const FLAGGED = ['fail', 'missing', 'confirm']
const FOLDED = ['header', 'sources', 'notes']
const SECTION_TITLE = { header: 'File header and revision notes' }
const TABS = [['summary', 'Summary'], ['comparison', 'Comparison'], ['timeline', 'Timeline'], ['documents', 'Documents']]
export const TAB_IDS = TABS.map(t => t[0])

// Page-local state, reset when another evaluation opens.
const ui = { id: null, adding: false, addKind: 'message_sent', pending: [], editing: false, showPu: false, file: null, fileSrc: {}, urls: {}, pasteTo: null, attachTo: null }
function resetPage(id) {
  if (ui.id === id) return
  ui.pending.forEach(p => URL.revokeObjectURL(p.url))
  Object.assign(ui, { id, adding: false, addKind: 'message_sent', pending: [], editing: false, showPu: false, file: null, pasteTo: null, attachTo: null })
}
export const hooks = { render: () => {} }
const row = () => state.rows.find(x => x.id === state.evalId)
const evidenceOf = evId => (state.data.evidence || []).filter(x => x.event_id === evId)
const filesOf = r => (state.data.files || []).filter(f => f.evaluation_id === r.id).sort((a, b) => (b.doc_date || '').localeCompare(a.doc_date || '') || a.name.localeCompare(b.name))

// ── Markdown bits of the comparison file ──
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
export function docFor(id) {
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
  const key = `${state.evalId}:${si}`
  const open = state.secOpen.has(key) ? state.secOpen.get(key) : !FOLDED.includes(sec.kind)
  return `
    <details class="fe-sec k-${sec.kind}" data-sec="${si}"${open ? ' open' : ''}>
      <summary><h2>${md(title, { notes: false })}</h2>
        ${counts.map(([t, n]) => `<span class="tchip t-${t}">${n} ${TONE_LABEL[t]}</span>`).join('')}
        <span class="fe-chev">${icon('right', 18)}</span></summary>
      <div class="fe-body">${sec.blocks.map((b, bi) => block(b, si, bi, sec)).join('') || '<p class="fe-p muted">Empty section.</p>'}</div>
    </details>`
}

// ── The station line ──
function tracker(r) {
  const ro = readOnly()
  const fromFile = k => r.fromFile.has(k === 'decision' ? 'outcome' : COLUMN[k])
  const st = r.stations.map(s => {
    const tip = s.state === 'now'
      ? s.days != null ? `At ${s.label} ${s.days} d · since ${fmtDate(s.since)}` : `${s.label}${s.result ? `: ${s.result}` : ''}${s.date ? ` · ${fmtDate(s.date)}` : ''}`
      : s.inferred || s.review ? `${s.label}: ${s.result} · ${s.basis}`
      : s.state === 'done' ? `${s.label}${s.days != null ? ` took ${s.days} d` : ''}${s.from && s.date ? ` · ${fmtDate(s.from)} → ${fmtDate(s.date)}` : s.date ? ` · ${fmtDate(s.date)}` : ''}${s.est ? ' (date estimated)' : ''}`
      : s.state === 'skipped' ? `${s.label}: not recorded` : `${s.label}: not reached yet`
    // While someone else has it, the current station's ring turns blue.
    const tone = s.tone + (s.state === 'now' && r.status === 'in_progress' ? ' holding' : '')
    const tag = ro ? 'div' : 'button'
    const attrs = ro ? '' : ` type="button" data-menu="stage-${s.key}"${fromFile(s.key) ? ' data-locked="1"' : ''}`
    const train = s.state === 'now' ? `<span class="train">${icon('train', 13)}${r.stages.outcome ? esc(s.result) : s.days != null ? `Here · ${s.days} d` : 'Here'}</span>` : ''
    return `<${tag} class="st ${s.state}${s.filled ? ' filled' : ''} t-${tone}" data-tip="${esc(tip)}"${attrs}>${train}<span class="dot">${s.state === 'done' || s.filled ? icon(s.tone === 'red' ? 'x' : 'check', 14) : ''}</span>
      <b>${esc(s.label)}</b><span class="res">${esc(s.result) || '&nbsp;'}</span><span class="when">${s.sub ? esc(s.sub) : s.inferred ? 'inferred' : s.date ? `${fmtDate(s.date)}${s.est ? '*' : ''}` : s.state === 'now' && s.since ? `since ${fmtDate(s.since)}` : '&nbsp;'}</span></${tag}>`
  }).join('')
  const h = r.holder
  const open = r.openRequests.filter(q => q.topic !== 'form')
  const holder = h.closed
    ? `<span class="who"><span class="av">${icon('check', 13)}</span>Closed: ${esc(STATUS[r.status].label)}</span><span class="what">${h.since ? `on ${fmtDate(h.since)}` : ''}${r.avlNotListed ? ` · <b class="warn-text">not on QA's AVL yet</b>` : ''}</span>`
    : h.you
      ? `<span class="who"><span class="av">RD</span>With you</span><span class="what">${h.since ? `since ${fmtDate(h.since)} · ${daysBetween(h.since, todayIso())} d · ` : ''}${esc(r.nextAction || r.nextStep || '')}</span>`
      : `<span class="who"><span class="av">${esc(h.who.slice(0, 2).toUpperCase())}</span>With ${esc(h.who)}</span><span class="what">since ${fmtDate(h.since)} · ${daysBetween(h.since, todayIso())} d${h.what.length ? ` · ${esc(h.what.join('; '))}` : ''}</span>`
  return `
    <section class="tracker" aria-label="Where this evaluation is">
      <div class="line">${st}</div>
      <div class="holder">${holder}
        ${ro ? '' : `<span class="holder-acts">${open.map(q => `<button class="btn soft small" data-act="received" data-id="${q.id}" title="${esc(q.what || '')}">Mark received${open.length > 1 ? ` · ${fmtDate(q.event_date)}` : ''}</button>`).join('')}
          <button class="btn soft small" data-act="add-entry">${icon('plus', 14)} Add entry</button></span>`}
      </div>
    </section>`
}

// Menu for one station: its values and Clear, or why it can't be changed here.
export function stageMenu(anchor, key) {
  const r = row()
  if (!r) return
  const k = key === 'decision' ? 'outcome' : key
  const title = k === 'outcome' ? 'Decision' : STAGES.find(s => s.key === k).label
  if (anchor.dataset.locked) return openMenu(anchor, [], { html: `<p class="menu-head">${esc(title)}</p><p class="menu-text">Set by the tracker block in the comparison file. Change it there, then scan.</p>` })
  const values = k === 'outcome' ? OUTCOMES : STAGES.find(s => s.key === k).values
  const cur = r.stages[k]
  const warn = k === 'outcome' && r.stages.qc !== 'approved' ? 'Approved before the QC sample: say why in the timeline.' : k === 'docs' && r.stages.coa !== 'pass' ? 'Docs usually wait until the CoA passes.' : null
  openMenu(anchor, [
    { head: title },
    ...values.map(([v, l]) => ({ label: l, act: 'set-stage', id: k, value: String(v), on: cur === v })),
    ...(cur != null ? [{ sep: true }, { label: 'Clear', act: 'set-stage', id: k, value: '' }] : []),
    ...(warn ? [{ sep: true }, { head: warn }] : []),
  ])
}

// ── Header ──
function header(r) {
  const f = facts(state.docs[r.id]?.body)
  const products = productNames(r.products)
  const ro = readOnly()
  const back = state.backHash || (ro ? `#/v/${state.viewToken}/evaluations` : '#/evaluations')
  return `
    <div class="ev-top">
      <a class="pill" href="${back}">${icon('left', 16)}<span>${/overview|^#\/?$|\/v\/[^/]+$/.test(back) ? 'Overview' : 'Evaluations'}</span></a>
      <div class="ev-actions">
        ${isDesktop() && r.fileName ? `<button class="btn surface" data-act="eval-file">${icon('file', 15)} Open file</button>` : ''}
        ${ro ? `<button class="btn surface" data-act="copy-here">${icon('link', 15)} Copy link</button>`
          : `<button class="btn surface" data-menu="handoff">${icon('send', 15)} Hand off ${icon('chevDown', 14)}</button>`}
      </div>
    </div>
    <header class="evh">
      <p class="eyebrow">${esc([r.materialName, r.grade].filter(Boolean).join(' · '))}${r.itemCode ? ` · item ${esc(r.itemCode)}` : ''}</p>
      <div class="evh-title"><h1>${r.candidate ? esc(r.candidate) : 'Candidate not set'}</h1>${pill(r, 'big')}</div>
      <div class="evh-meta">
        ${r.manufacturer && r.manufacturer !== r.candidate ? `<span>${esc(r.manufacturer)}</span>` : ''}
        ${r.supplier ? `<span>via ${esc(r.supplier)}</span>` : ''}
        ${f.price ? `<span>฿${esc(f.price)} / kg</span>` : ''}
        ${r.rev != null ? `<span>R.${r.rev} · ${fmtDate(r.revDate)}</span>` : ''}
        ${products.length ? `<span class="chips">${products.map(p => `<span class="chip-tag">${esc(p)}</span>`).join('')}</span>` : ''}
      </div>
    </header>`
}

export function handoffMenu(anchor) {
  const link = viewLink(state.evalId)
  openMenu(anchor, [
    { label: 'Copy new chat prompt', act: 'copy-prompt', id: state.evalId, hint: 'The /rm-eval-handoff starter, filled in' },
    { label: ui.showPu ? 'Hide PU message' : 'Write PU message', act: 'toggle-pu', hint: 'Thai, golden form, ready to copy' },
    { label: 'Copy view link', act: 'copy-view-link', hint: link ? 'For managers: this page, view only' : 'Make the link in Settings first' },
    { sep: true },
    { label: 'One-page summary (PDF)', act: 'print-eval' },
  ], { align: 'right' })
}

// ── Summary ──
function summaryTab(r, doc) {
  const t = doc ? tally(doc) : null
  const issues = doc ? issuesOf(doc) : []
  const fullVerdict = doc?.sections.find(s => s.kind === 'verdict')?.blocks.find(b => b.type === 'p' || b.type === 'quote')?.text
  const verdict = fullVerdict || r.verdictLine
  const f = facts(state.docs[r.id]?.body)
  const ro = readOnly()
  const SUGGEST = { pass: 'CoA Pass', gap: 'CoA Missing', fail: 'CoA Fail', closed_ok: 'Decision Approved', closed_no: 'Decision Not approved' }
  const showPu = !ro && (ui.showPu || r.status === 'missing')
  const tile = (tone, n, label, jump) => `<button class="tile t-${tone}${n ? '' : ' zero'}" ${n && jump ? `data-act="jump" data-value="${jump}"` : 'disabled'}><b>${n}</b><span>${label}</span></button>`
  const firstOf = tone => issues.find(x => x.tone === tone)?.anchor
  return `
    <div class="sum">
      <div class="col">
        ${verdict ? `<div class="verdict"><small>Verdict${r.rev != null ? ` · R.${r.rev}` : ''}</small>${md(verdict)}</div>` : `<div class="verdict muted">${r.fileName ? 'No verdict line in this file (older format, verdict only in the count table).' : 'No comparison file yet.'}</div>`}
        ${!ro && r.suggested ? `<div class="suggest">${icon('sparkle', 16)} The verdict line says <b>${esc(SUGGEST[r.suggested])}</b>. <button class="btn soft small" data-act="accept-suggest" data-value="${r.suggested}">Use it</button></div>` : ''}
        ${t ? `<div class="tiles">
          ${tile('fail', t.fail, 'Fail', firstOf('fail'))}${tile('missing', t.missing, 'Missing', firstOf('missing'))}${tile('confirm', t.confirm, 'Confirm', firstOf('confirm'))}${tile('pass', t.pass, 'Pass')}${tile('missing', t.docsMissing, 'Docs missing', issues.find(x => x.section.kind === 'docs')?.anchor)}
        </div>` : ''}
        ${issues.length ? `<div class="panel">
          <h3>Needs attention <span class="count">${issues.length}</span></h3>
          <div class="attn-list">${issues.slice(0, 8).map(x => `<button class="attn t-${x.tone}" data-act="jump" data-value="${x.anchor}">
            <span class="tchip t-${x.tone}">${TONE_LABEL[x.tone]}</span>
            <span class="attn-main"><b>${esc(x.label)}</b><span>${esc(x.text.length > 150 ? x.text.slice(0, 147) + '…' : x.text)}</span></span></button>`).join('')}</div>
          ${issues.length > 8 ? `<a class="more-link" href="${evalHash(r.id, 'comparison')}">All ${issues.length} in the Comparison tab</a>` : ''}
        </div>` : ''}
        ${showPu ? puPanel(r, doc) : ''}
      </div>
      <div class="col">
        ${factsPanel(r, f)}
        ${r.openRequests.length ? `<div class="panel"><h3>Open requests</h3><ul class="asks">${r.openRequests.map(q => `<li class="t-${waitTone(q.days) === 'ok' ? 'blue' : waitTone(q.days)}"><i></i><span><b>${esc(q.what || 'Documents')}</b> · ${esc(q.party || 'PU')}, ${fmtDate(q.event_date)} · ${q.days} d${q.topic === 'form' ? ' · signed form only' : ''}</span></li>`).join('')}</ul></div>` : ''}
      </div>
    </div>`
}

function puPanel(r, doc) {
  const msg = puMessage(r, { body: state.docs[r.id]?.body, doc, link: viewLink(r.id) })
  return `<div class="panel pu">
    <h3>PU message <span class="h3-acts"><button class="btn small dark" data-act="copy-pu">${icon('copy', 14)} Copy</button><button class="btn small cta" data-act="log-sent">Log as sent</button></span></h3>
    <pre class="thai" id="pu-text">${esc(msg.text)}</pre>
    <p class="note">Built in the golden form from the stages and the file's flagged rows; trim it before sending. Log as sent records the message${msg.asks.length ? ' and the request' : ''}; then paste the LINE screenshot (Ctrl+V) to attach it.</p>
  </div>`
}

const FIELDS = [['candidate_name', 'Candidate', 'candidate'], ['manufacturer', 'Manufacturer', 'manufacturer'], ['supplier', 'Distributor', 'supplier'], ['item_code', 'Item code', 'item_code'], ['next_action', 'Next action', 'next_action']]
function factsPanel(r, f) {
  const ro = readOnly()
  if (ui.editing && !ro) {
    const field = ([k, label, fileKey]) => {
      const file = r.fromFile.has(fileKey)
      const val = { candidate_name: r.candidate, manufacturer: r.manufacturer, supplier: r.supplier, item_code: r.itemCode, next_action: r.nextAction }[k]
      return `<label class="field">${label}${file ? '<span class="from-file">from file</span>' : ''}<input name="${k}" value="${esc(val ?? '')}" ${file ? 'disabled' : ''}></label>`
    }
    return `<form class="panel fields" data-form="fields">
      <h3>Details</h3>
      ${FIELDS.map(field).join('')}
      <label class="field">Type${r.fromFile.has('kind') ? '<span class="from-file">from file</span>' : ''}
        <select name="kind" ${r.fromFile.has('kind') ? 'disabled' : ''}>${[['', 'Not set'], ['api', 'API'], ['excipient', 'Excipient']].map(([v, l]) => `<option value="${v}"${(r.kind || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">Notes (shown in the status list)<textarea name="notes" rows="3">${esc(r.raw.notes || '')}</textarea></label>
      <div class="row-end"><button type="button" class="btn ghost small" data-act="edit-facts">Cancel</button><button class="btn primary small" type="submit">Save</button></div>
    </form>`
  }
  const dl = [
    ['Manufacturer', r.manufacturer], ['Distributor', r.supplier], ['Price', f.price ? `฿${f.price} / kg` : null],
    ['Item code', r.itemCode], ['Type', r.kind ? (r.kind === 'api' ? 'API' : 'Excipient') : null],
    ['Reference', f.opLine ? (f.opLine.length > 140 ? f.opLine.slice(0, 137) + '…' : f.opLine) : null],
    ['CoA cites', f.candEdition], ['Used in', productNames(r.products).join(', ') || null],
    ['Next', r.nextAction || r.nextStep], ['Notes', r.raw.notes], ['File', r.fileName ? `R.${r.rev} · ${fmtDate(r.revDate)}` : null],
  ].filter(([, v]) => v)
  return `<div class="panel">
    <h3>Facts ${ro ? '' : `<button class="btn ghost small h3-right" data-act="edit-facts">Edit</button>`}</h3>
    <dl class="facts">${dl.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
  </div>`
}

// ── Comparison ──
function comparisonTab(r, doc) {
  const entry = state.docs[r.id]
  if (!doc) return emptyDoc(r, entry)
  const issues = issuesOf(doc)
  return `
    <div class="cmp-bar">
      <div class="seg" role="group" aria-label="Rows">
        <button type="button" class="${state.prefs.issuesOnly ? '' : 'on'}" data-act="issues-only" data-value="0">All rows</button>
        <button type="button" class="${state.prefs.issuesOnly ? 'on' : ''}" data-act="issues-only" data-value="1">Flagged only</button>
      </div>
      <span class="note">${esc(r.fileName || '')} · scanned ${entry.at ? fmtDate(entry.at.slice(0, 10)) : ''}. Rows are marked from the Verdict or Status column; amber cells say a result was not reported.</span>
    </div>
    <div class="fe-sections">${doc.sections.map((s, si) => section(s, si, issues)).join('')}</div>`
}
function emptyDoc(r, entry) {
  if (!entry) return `<div class="fe-empty">${icon('sync', 18)} Loading the comparison file…</div>`
  if (entry.error) return `<div class="fe-empty"><b>The comparison file couldn't be loaded.</b><p>${esc(entry.error)}</p></div>`
  return `<div class="fe-empty"><b>No comparison file scanned for this evaluation yet.</b><p>${r.fileName ? 'Run a scan (desktop Re-scan or the 08:30 task) to load it.' : 'The documents are in, but nobody has written the comparison file.'}</p></div>`
}

// ── Timeline ──
const STAGE_WORD = { pass: 'Pass', gap: 'Missing', fail: 'Fail', approved: 'Approved', not_approved: 'Not approved', closed: 'Closed', true: 'Listed', false: 'New source' }
function timelineTab(r) {
  const ro = readOnly()
  const evs = r.events.slice().reverse()
  const k = ui.addKind
  const form = ui.adding && !ro ? `<form class="add-event panel" data-form="event">
    <div class="choice">${Object.entries(EVENT_KINDS).filter(([x]) => x !== 'stage').map(([x, v]) => `<label class="choice-item"><input type="radio" name="kind" value="${x}" ${k === x ? 'checked' : ''}><span>${icon(v.icon, 14)} ${v.label}</span></label>`).join('')}</div>
    <div class="field-row">
      <label class="field" style="flex:0 0 160px">Date<input name="event_date" type="date" value="${todayIso()}" required></label>
      <label class="field">${k === 'message_sent' ? 'To' : k === 'docs_received' ? 'From' : 'Who'}<input name="party" placeholder="${k === 'docs_received' ? 'PU, supplier…' : 'PU, K. Am, QA manager…'}"></label>
      <label class="field">${k === 'verdict' ? 'Verdict' : 'Documents'}<input name="what" placeholder="${k === 'verdict' ? 'Missing: GMP certificate' : 'GMP, MSDS, 50 g sample'}"></label>
    </div>
    <label class="field">${k === 'message_sent' ? 'What was said' : 'Note'}<textarea name="note" rows="2"></textarea></label>
    ${k === 'docs_requested' ? `<label class="check-line"><input type="checkbox" name="topic_form"> Paperwork only (a signed form): doesn't move it to In progress</label>` : ''}
    <div class="drop-zone">${ui.pending.map((p, i) => `<span class="pend"><img src="${esc(p.url)}" alt=""><button type="button" class="icon-btn small" data-act="unpend" data-value="${i}" aria-label="Remove image">${icon('x', 13)}</button></span>`).join('')}
      <button type="button" class="btn ghost small" data-act="pick-img">${icon('image', 15)} Add images</button><span class="muted small">or paste (Ctrl+V) or drop a screenshot here</span></div>
    ${k === 'docs_received' && r.openRequests.length ? `<label class="check-line"><input type="checkbox" name="close" checked> Close the ${r.openRequests.length} open request${r.openRequests.length > 1 ? 's' : ''}</label>` : ''}
    <div class="row-end"><button class="btn ghost small" type="button" data-act="add-entry">Cancel</button><button class="btn primary small" type="submit">Add to timeline</button></div>
  </form>` : ''
  const thumbs = ev => {
    const list = evidenceOf(ev.id)
    return list.length ? `<div class="ev-imgs">${list.map(x => `<button class="ev-thumb" data-act="view-img" data-id="${x.id}" title="${esc(x.file_name || 'Evidence image')}">${ui.urls[x.path] ? `<img src="${esc(ui.urls[x.path])}" alt="">` : icon('image', 16)}</button>`).join('')}</div>` : ''
  }
  const item = ev => {
    if (ev.kind === 'stage') {
      const label = STATIONS.find(([s]) => s === (ev.what === 'outcome' ? 'decision' : ev.what))?.[1] ?? ev.what
      return `<li class="tl-item stage"><span class="d">${fmtDate(ev.event_date)}${ev.estimated ? '*' : ''}</span><span class="k"><i></i></span>
        <div class="b"><small>Stage · ${esc(label)} → ${esc(ev.note == null ? 'cleared' : STAGE_WORD[ev.note] ?? ev.note)}${ev.estimated ? ' · date estimated' : ''}</small></div></li>`
    }
    const q = r.openRequests.find(x => x.id === ev.id)
    return `<li class="tl-item k-${ev.kind}"><span class="d">${fmtDate(ev.event_date)}</span><span class="k"><i></i></span>
      <div class="b">
        <div class="ev-head"><b>${EVENT_KINDS[ev.kind].label}</b>${ev.party ? `<span>· ${esc(ev.party)}</span>` : ''}<span class="src">${ev.source}</span>
          ${ev.topic === 'form' ? '<span class="tag form">Form</span>' : ''}
          ${ev.kind === 'docs_requested' ? ev.closed_on ? `<span class="tag ok">Received ${fmtDate(ev.closed_on)}</span>` : `<span class="wait w-${waitTone(q?.days)}">Open · ${q?.days ?? 0} d</span>` : ''}</div>
        ${ev.what ? `<div class="ev-what">${esc(ev.what)}</div>` : ''}
        ${ev.note ? `<div class="ev-note">${esc(ev.note)}</div>` : ''}
        ${thumbs(ev)}
      </div>
      ${ro ? '' : `<div class="ev-acts">
        <button class="icon-btn small" data-act="attach" data-id="${ev.id}" aria-label="Add image" title="Add evidence image">${icon('image', 15)}</button>
        ${ev.kind === 'docs_requested' && !ev.closed_on ? `<button class="btn soft small" data-act="received" data-id="${ev.id}">Received</button>` : ''}
        ${ev.source !== 'scan' ? `<button class="icon-btn small" data-act="del-ev" data-id="${ev.id}" aria-label="Delete">${icon('trash', 15)}</button>` : ''}
      </div>`}
    </li>`
  }
  return `
    ${ro || ui.adding ? '' : `<div class="tl-bar"><button class="btn soft small" data-act="add-entry">${icon('plus', 14)} Add entry</button><span class="note">Stage changes land here as you make them. Dates marked * are estimated from older entries.</span></div>`}
    ${form}
    <ol class="tl panel">${evs.length ? evs.map(item).join('') : '<li class="empty">Nothing logged yet.</li>'}</ol>
    <input type="file" accept="image/*" multiple hidden data-file>`
}

// ── Documents ──
function documentsTab(r) {
  const files = filesOf(r)
  const canShow = f => isDesktop() || !!f.path
  const pick = files.find(f => f.id === ui.file) || files.find(canShow) || files[0]
  let viewer
  if (!pick) viewer = `<div class="fe-empty"><b>No documents recorded for this evaluation.</b><p>The scan lists what's in its Document\\YYMMDD\\ folders.</p></div>`
  else if (!canShow(pick)) viewer = `<div class="fe-empty"><b>${esc(pick.name)}</b><p>This file is only on the work PC. The scan uploads each candidate's latest Selection Form and CoA; older documents stay in the folder.</p></div>`
  else {
    const src = isDesktop() ? `vetted-file://doc/${encodeURIComponent(pick.rel)}` : ui.fileSrc[pick.path]
    if (!src && !isDesktop()) loadFileSrc(pick.path)
    viewer = src ? `<div class="pdf-wrap"><p class="pdf-loading">${icon('sync', 16)} Opening ${esc(pick.name.replace(/^\d{6}\s+/, ''))}…</p><iframe class="pdf-frame" src="${esc(src)}" title="${esc(pick.name)}"></iframe></div>` : `<div class="fe-empty">${icon('sync', 18)} Loading ${esc(pick.name)}…</div>`
  }
  const byDate = {}
  for (const f of files) (byDate[f.doc_date || ''] ||= []).push(f)
  return `
    <div class="viewer">
      <div class="files panel">
        ${files.length ? Object.entries(byDate).map(([d, list]) => `<p class="files-date">${d ? fmtDate(d) : 'Undated'}</p>${list.map(f => `
          <button class="file${f === pick ? ' on' : ''}${canShow(f) ? '' : ' off'}" data-act="pick-file" data-id="${f.id}" title="${esc(f.name)}">
            <b>${esc(f.name.replace(/^\d{6}\s+/, ''))}</b><span>${f.size ? `${(f.size / 1048576).toFixed(1)} MB` : ''}${isDesktop() ? '' : f.path ? ' · online' : ' · work PC only'}</span></button>`).join('')}`).join('')
          : '<p class="empty">No documents.</p>'}
        ${r.fileName ? `<p class="files-date">Comparison</p><a class="file" href="${evalHash(r.id, 'comparison')}"><b>R.${r.rev} · ${fmtDate(r.revDate)}</b><span>Open in the Comparison tab</span></a>` : ''}
      </div>
      <div class="pdf">${viewer}</div>
    </div>`
}
async function loadFileSrc(path) {
  if (path in ui.fileSrc) return
  ui.fileSrc[path] = null
  try { ui.fileSrc[path] = await fileUrl(path); hooks.render() } catch (e) { toast(e.message) }
}

// Signed links for evidence thumbnails not loaded yet.
async function loadUrls(r) {
  const need = r.events.flatMap(ev => evidenceOf(ev.id)).map(x => x.path).filter(p => !(p in ui.urls))
  if (!need.length) return
  need.forEach(p => { ui.urls[p] = '' })
  try { Object.assign(ui.urls, await evidenceUrls(need)); hooks.render() } catch (err) { toast(err.message) }
}

export function renderEvaluation() {
  const r = row()
  if (!r) return `<div class="fe-empty"><p>This evaluation isn't in the list any more.</p><a class="btn soft" href="#/evaluations">${icon('left', 16)} Evaluations</a></div>`
  resetPage(r.id)
  if (state.openPu) { ui.showPu = true; state.openPu = false }
  const doc = docFor(r.id)
  const t = doc ? tally(doc) : null
  const nFiles = filesOf(r).length
  const counts = { comparison: t ? t.fail + t.missing + t.confirm + t.pass : null, timeline: r.events.length, documents: nFiles || null }
  const tab = TAB_IDS.includes(state.tab) ? state.tab : 'summary'
  if (tab === 'timeline') loadUrls(r)
  const body = { summary: () => summaryTab(r, doc), comparison: () => comparisonTab(r, doc), timeline: () => timelineTab(r), documents: () => documentsTab(r) }[tab]()
  const pre = state.viewToken ? `#/v/${state.viewToken}` : ''
  return `
    ${header(r)}
    ${tracker(r)}
    <nav class="tabs" aria-label="Sections">${TABS.map(([k, l]) => `<a class="tab${tab === k ? ' on' : ''}" href="${pre}${evalHash(r.id, k)}">${l}${counts[k] ? ` <small>${counts[k]}</small>` : ''}</a>`).join('')}</nav>
    <div class="tab-body">${body}</div>`
}

// ── Actions (main.js passes data-act clicks here first) ──
const imagesOf = items => [...items].map(x => x.kind === 'file' ? x.getAsFile() : x).filter(f => f?.type?.startsWith('image/'))

function viewImage(img) {
  const url = ui.urls[img.path]
  if (!url) return
  const m = openModal(`
    <div class="lightbox">
      <img src="${esc(url)}" alt="${esc(img.file_name || 'Evidence image')}">
      <div class="row-end"><span class="muted small clip">${esc(img.file_name || '')}</span>
        ${readOnly() ? '' : `<button class="btn ghost small" data-del>${icon('trash', 15)} Delete image</button>`}
        <button class="btn primary small" data-close>Close</button></div>
    </div>`, { wide: true })
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => { m.close(); try { await deleteImage(img) } catch (err) { toast(err.message) } })
}

const promptFor = r => chatPrompt(r, {
  body: state.docs[r.id]?.body, root: state.prefs.root || DEFAULT_ROOT,
  siblings: state.rows.filter(x => x.material.id === r.material.id).map(x => ({ ...x, statusLabel: STATUS[x.status].label })),
})
export const copyPromptFor = r => copyText(promptFor(r), 'Chat prompt copied')

export async function evalAction(act, el) {
  const r = row()
  if (!r) return false
  switch (act) {
    case 'set-stage': {
      closeMenu()
      const k = el.dataset.id
      const raw = el.dataset.value
      const v = raw === '' ? null : raw === 'true' ? true : raw === 'false' ? false : raw
      const word = v == null ? 'cleared' : (k === 'outcome' ? OUTCOMES : STAGES.find(s => s.key === k).values).find(([x]) => String(x) === raw)?.[1]
      await setStage(r, k, v, `${k === 'outcome' ? 'Decision' : STAGES.find(s => s.key === k).label}: ${word}`)
      return true
    }
    case 'accept-suggest':
      for (const [k, v] of Object.entries(stampToStages(el.dataset.value))) await setStage(r, k, v, `${k === 'outcome' ? 'Decision' : 'CoA'} set from the verdict line`)
      return true
    case 'edit-facts': ui.editing = !ui.editing; hooks.render(); return true
    case 'toggle-pu':
      closeMenu()
      ui.showPu = !ui.showPu
      if (state.tab !== 'summary') location.hash = evalHash(r.id)
      else hooks.render()
      setTimeout(() => document.querySelector('.panel.pu')?.scrollIntoView({ block: 'center' }), 80)
      return true
    case 'copy-pu': copyText(document.getElementById('pu-text')?.textContent || '', 'PU message copied'); return true
    case 'log-sent': {
      const msg = puMessage(r, { body: state.docs[r.id]?.body, doc: docFor(r.id) })
      const ev = await logSent(r, { message: msg.summary, asks: msg.asks })
      ui.pasteTo = ev.id
      ui.showPu = false
      hooks.render()
      toast('Logged as sent. Paste the LINE screenshot now (Ctrl+V) to attach it.')
      return true
    }
    case 'copy-prompt': closeMenu(); copyPromptFor(r); return true
    case 'copy-view-link': {
      closeMenu()
      const link = viewLink(r.id)
      if (!link) toast('No view link yet: make one in Settings')
      else copyText(link, 'View link copied')
      return true
    }
    case 'copy-here': copyText(location.href, 'Link copied'); return true
    case 'print-eval': closeMenu(); printEvaluation(r, docFor(r.id), facts(state.docs[r.id]?.body)); return true
    case 'add-entry':
      ui.adding = !ui.adding
      if (!ui.adding) { ui.pending.forEach(p => URL.revokeObjectURL(p.url)); ui.pending = [] }
      if (ui.adding && state.tab !== 'timeline') location.hash = evalHash(r.id, 'timeline')
      else hooks.render()
      return true
    case 'pick-img': ui.attachTo = null; document.querySelector('[data-file]')?.click(); return true
    case 'attach': ui.attachTo = el.dataset.id; document.querySelector('[data-file]')?.click(); return true
    case 'unpend': URL.revokeObjectURL(ui.pending[+el.dataset.value].url); ui.pending.splice(+el.dataset.value, 1); hooks.render(); return true
    case 'view-img': { const img = (state.data.evidence || []).find(x => x.id === el.dataset.id); if (img) viewImage(img); return true }
    case 'del-ev': {
      const ev = state.data.events.find(x => x.id === el.dataset.id)
      const n = evidenceOf(ev.id).length
      if (!await confirmBox(n ? `Delete this entry and its ${n} image${n > 1 ? 's' : ''}? Ctrl+Z brings it back.` : 'Delete this entry? Ctrl+Z brings it back.')) return true
      await deleteEntry(ev)
      return true
    }
    case 'pick-file': ui.file = el.dataset.id; hooks.render(); return true
    case 'eval-file': window.electronAPI?.openPath({ root: state.prefs.root, rel: `${r.folder}/${r.fileName}` }); return true
  }
  return false
}

export async function evalChange(e) {
  if (state.view !== 'evaluation') return
  if (e.target.name === 'kind' && e.target.closest('[data-form="event"]')) { ui.addKind = e.target.value; hooks.render(); return }
  if (!e.target.matches('[data-file]')) return
  const files = imagesOf(e.target.files)
  e.target.value = ''
  if (!files.length) return
  const ev = ui.attachTo && state.data.events.find(x => x.id === ui.attachTo)
  if (!ev) { ui.pending.push(...files.map(f => ({ file: f, url: URL.createObjectURL(f) }))); hooks.render(); return }
  try { await addImages(ev, files) } catch (err) { toast(err.message) }
}

export async function evalSubmit(e) {
  const r = row()
  if (!r) return
  e.preventDefault()
  const fd = new FormData(e.target)
  const btn = e.target.querySelector('[type=submit]')
  btn.disabled = true
  try {
    if (e.target.dataset.form === 'fields') {
      const patch = {}
      for (const k of ['candidate_name', 'manufacturer', 'supplier', 'item_code', 'next_action', 'notes']) if (fd.has(k)) patch[k] = fd.get(k).trim() || null
      ui.editing = false
      await saveFields(r, patch, fd.has('kind') ? fd.get('kind') || null : undefined)
    } else {
      const kind = fd.get('kind')
      const files = ui.pending.map(p => p.file)
      const close = kind === 'docs_received' && fd.get('close') ? r.openRequests.map(q => q.id) : []
      ui.adding = false
      await addEntry(r, { kind, event_date: fd.get('event_date'), what: fd.get('what').trim() || null, party: fd.get('party').trim() || null, note: fd.get('note').trim() || null, topic: kind === 'docs_requested' && fd.get('topic_form') ? 'form' : null }, files, close)
      ui.pending.forEach(p => URL.revokeObjectURL(p.url))
      ui.pending = []
      toast(`${EVENT_KINDS[kind].label} logged`)
    }
  } catch (err) { toast(err.message); btn.disabled = false }
}

// A pasted screenshot goes to the entry being added, or to the request just logged as sent.
export async function evalPaste(e) {
  if (readOnly() || state.view !== 'evaluation') return
  const files = imagesOf(e.clipboardData?.items || [])
  if (!files.length) return
  if (ui.adding) { e.preventDefault(); ui.pending.push(...files.map(f => ({ file: f, url: URL.createObjectURL(f) }))); hooks.render(); return }
  const ev = ui.pasteTo && state.data.events.find(x => x.id === ui.pasteTo)
  if (ev) { e.preventDefault(); ui.pasteTo = null; try { await addImages(ev, files) } catch (err) { toast(err.message) } }
}
export function evalDrop(e) {
  if (readOnly() || !ui.adding || !e.target.closest('.add-event')) return false
  e.preventDefault()
  const files = imagesOf(e.dataTransfer?.files || [])
  if (files.length) { ui.pending.push(...files.map(f => ({ file: f, url: URL.createObjectURL(f) }))); hooks.render() }
  return true
}
