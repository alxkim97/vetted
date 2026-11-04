// One evaluation: verdict, stages, editable fields, and the timeline with an
// add form and its evidence images.
import { state, rebuild, cacheData } from './store.js'
import { STAGES, OUTCOMES, EVENT_KINDS, fmtDate, todayIso, waitTone } from './model.js'
import { stampToStages } from '../lib/parse.js'
import { updateEvaluation, updateMaterial, addEvent, updateEvent, deleteEvent, addEvidence, deleteEvidence, evidenceUrls } from './data.js'
import { esc, icon, openModal, toast, confirmBox } from './ui.js'
import { pill } from './views/register.js'

const isDesktop = () => !!window.electronAPI?.isElectron
// Set by main.js: opens the full evaluation page.
export const hooks = { openFull: null }
const replace = (list, row) => { const i = list.findIndex(x => x.id === row.id); if (i >= 0) list[i] = row; else list.push(row) }
const imagesOf = items => [...items].map(x => x.kind === 'file' ? x.getAsFile() : x).filter(f => f?.type?.startsWith('image/'))
const evidenceOf = evId => (state.data.evidence || []).filter(x => x.event_id === evId)
// The column a stage input writes to (AVL check is avl_listed).
const COLUMN = { avl: 'avl_listed', coa: 'coa', docs: 'docs', qc: 'qc', outcome: 'outcome' }
const parseValue = v => v === 'true' ? true : v === 'false' ? false : v
// What a verdict-line suggestion (an old-style stamp) sets.
const SUGGEST = { pass: 'CoA Pass', gap: 'CoA Missing', fail: 'CoA Fail', closed_ok: 'Outcome Approved', closed_no: 'Outcome Not approved' }

// Full-size image over the sheet; Delete removes it from the bucket too.
function viewImage(row, url, onDelete) {
  const m = openModal(`
    <div class="lightbox">
      <img src="${esc(url)}" alt="${esc(row.file_name || 'Evidence image')}">
      <div class="row-end"><span class="muted small clip">${esc(row.file_name || '')}</span>
        <button class="btn ghost small" data-del>${icon('trash', 15)} Delete image</button>
        <button class="btn primary small" data-close>Close</button></div>
    </div>`, { wide: true })
  m.el.querySelector('[data-del]').onclick = async () => {
    if (!await confirmBox('Delete this image?')) return
    try { await deleteEvidence(row); m.close(); onDelete() } catch (err) { toast(err.message) }
  }
}

export function openDetail(id, onChange) {
  const m = openModal('<div class="detail"></div>', { wide: true })
  const el = m.el.querySelector('.detail')
  let addKind = 'message_sent'
  let adding = false        // add-entry form folded until asked for
  let detailsOpen = false
  let pending = []          // images waiting to go with the entry being added
  let attachTo = null       // event the file picker adds images to (null = the add form)
  const urls = {}           // evidence path → signed URL

  // Fetch links for any thumbnail that doesn't have one yet, then redraw.
  async function loadUrls() {
    const r = state.rows.find(x => x.id === id)
    const need = (r?.events || []).flatMap(ev => evidenceOf(ev.id)).map(x => x.path).filter(p => !urls[p])
    if (!need.length) return
    try { Object.assign(urls, await evidenceUrls(need)); draw() } catch (err) { toast(err.message) }
  }
  async function attach(ev, files) {
    for (const f of files) state.data.evidence = [...(state.data.evidence || []), await addEvidence(ev, f)]
    cacheData(); loadUrls()
  }
  // The image strip in the add form redraws on its own, so typed text survives.
  const dropZone = () => `
    ${pending.map((p, i) => `<span class="pend"><img src="${esc(p.url)}" alt=""><button type="button" class="icon-btn small" data-d="unpend" data-value="${i}" aria-label="Remove image">${icon('x', 13)}</button></span>`).join('')}
    <button type="button" class="btn ghost small" data-d="pick-img">${icon('image', 15)} Add images</button>
    <span class="muted small">or paste (Ctrl+V) or drop a screenshot here</span>`
  const drawPending = () => { const z = el.querySelector('.drop-zone'); if (z) z.innerHTML = dropZone() }
  const addPending = files => { pending.push(...files.map(f => ({ file: f, url: URL.createObjectURL(f) }))); drawPending() }
  const clearPending = () => { pending.forEach(p => URL.revokeObjectURL(p.url)); pending = [] }

  const changed = () => { rebuild(); cacheData(); onChange(); draw(); loadUrls() }
  const save = async (patch, msg) => { replace(state.data.evaluations, await updateEvaluation(id, patch)); if (msg) toast(msg); changed() }

  const stageRow = (key, label, values, cur, fromFile, note = '') => `
    <div class="stage-row"><span class="stage-name">${label}${fromFile ? '<span class="from-file">from file</span>' : ''}</span>
      <div class="choice">
        ${values.map(([v, l, tone]) => `<label class="choice-item t-${tone}"><input type="radio" name="st-${key}" value="${String(v)}" ${cur === v ? 'checked' : ''} ${fromFile ? 'disabled' : ''}><span>${esc(l)}</span></label>`).join('')}
        ${!fromFile && cur != null ? `<button class="link small" type="button" data-d="clear-stage" data-value="${key}">Clear</button>` : ''}
        ${note ? `<span class="muted small">${note}</span>` : ''}
      </div></div>`
  const thumbs = ev => {
    const list = evidenceOf(ev.id)
    return list.length ? `<div class="ev-imgs">${list.map(x => `<button class="ev-thumb" data-d="view-img" data-id="${x.id}" title="${esc(x.file_name || 'Evidence image')}">${urls[x.path] ? `<img src="${esc(urls[x.path])}" alt="">` : icon('image', 16)}</button>`).join('')}</div>` : ''
  }

  const field = (key, label, value, { file, type = 'text' } = {}) => `
    <label class="field">${label}${file ? '<span class="from-file">from file</span>' : ''}
      <input name="${key}" type="${type}" value="${esc(value ?? '')}" ${file ? 'disabled' : ''}></label>`

  function draw() {
    const r = state.rows.find(x => x.id === id)
    if (!r) { m.close(); return }
    const f = r.fromFile
    const evs = r.events.slice().reverse()
    el.innerHTML = `
      <div class="modal-head">
        <div>
          <p class="eyebrow">${esc([r.materialName, r.grade].filter(Boolean).join(' · '))}</p>
          <h2>${r.candidate ? esc(r.candidate) : '<span class="muted">Candidate not set</span>'}</h2>
        </div>
        ${pill(r.status)}
        ${r.fileName && state.view !== 'evaluation' ? `<button class="btn primary small" data-d="full">${icon('grid', 15)} Full evaluation</button>` : ''}
        <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
      </div>
      <div class="modal-body">
        <div class="used-in"><span class="field-label">Used in</span>
          ${r.products.length ? `<div class="chips">${r.products.map(p => `<span class="chip-tag prod">${esc(p.name)} <span class="mono">${esc(p.code || '')}</span></span>`).join('')}</div>`
            : `<span class="muted small">${r.material.products?.length ? 'No product uses this grade' : 'No product linked yet'}</span>`}
        </div>
        ${r.verdictLine ? `<blockquote class="verdict">${esc(r.verdictLine)}</blockquote>` : r.fileName ? `<p class="muted small">No verdict line in this file (older format, verdict only in the count table).</p>` : ''}
        ${r.suggested ? `<div class="suggest">${icon('sparkle', 16)} The verdict line says <b>${esc(SUGGEST[r.suggested])}</b>. <button class="btn soft small" data-d="accept" data-value="${r.suggested}">Use it</button></div>` : ''}

        <div class="stage-box">
          ${STAGES.map(s => stageRow(s.key, s.label, s.values, r.stages[s.key], f.has(COLUMN[s.key]),
            s.key === 'docs' && r.stages.coa !== 'pass' && r.stages.docs == null ? 'Pending until the CoA passes' : '')).join('')}
          ${stageRow('outcome', 'Outcome', OUTCOMES, r.stages.outcome, f.has('outcome'),
            r.stages.outcome === 'approved' && r.stages.qc !== 'approved' ? 'Approved without a QC sample approval; say why in the timeline' : '')}
          ${r.nextStep ? `<p class="next-step">${icon('arrowUR', 14)} Next: ${esc(r.nextStep)}</p>` : ''}
        </div>

        <div class="durations">
          <div><b>${r.firstDocs ? fmtDate(r.firstDocs) : '—'}</b><span>First docs in</span></div>
          <div><b>${r.daysToVerdict ?? '—'}${r.daysToVerdict != null ? ' d' : ''}</b><span>Docs to verdict</span></div>
          <div><b>${r.ageDays ?? '—'}${r.ageDays != null ? ' d' : ''}</b><span>Open for</span></div>
          <div class="w-${waitTone(r.waitingDays)}"><b>${r.waitingDays ?? '—'}${r.waitingDays != null ? ' d' : ''}</b><span>Waiting on docs</span></div>
        </div>

        <section>
          <div class="sub-head"><h3 class="sub">${icon('clock', 16)} Timeline</h3>
            ${adding ? '' : `<button class="btn soft small" data-d="adding">${icon('plus', 15)} Add entry</button>`}</div>
          ${adding ? `<form class="add-event" data-form="event">
            <div class="choice">
              ${Object.entries(EVENT_KINDS).map(([k, v]) => `<label class="choice-item"><input type="radio" name="kind" value="${k}" ${addKind === k ? 'checked' : ''}><span>${icon(v.icon, 14)} ${v.label}</span></label>`).join('')}
            </div>
            <div class="field-row">
              <label class="field" style="flex:0 0 150px">Date<input name="event_date" type="date" value="${todayIso()}" required></label>
              <label class="field">${addKind === 'message_sent' ? 'To' : addKind === 'docs_received' ? 'From' : 'Who'}<input name="party" placeholder="${addKind === 'docs_received' ? 'PU, supplier…' : 'PU, K. Am, QA manager…'}"></label>
              <label class="field">${addKind === 'verdict' ? 'Verdict' : 'Documents'}<input name="what" placeholder="${addKind === 'verdict' ? 'Missing: GMP certificate' : 'GMP, MSDS, 50 g sample'}"></label>
            </div>
            <label class="field">${addKind === 'message_sent' ? 'What was said' : 'Note'}<textarea name="note" rows="2" placeholder="${addKind === 'message_sent' ? 'CoA verdict and the next documents asked for' : ''}"></textarea></label>
            ${addKind === 'docs_requested' ? `<label class="check-line"><input type="checkbox" name="topic_form"> Paperwork only (a signed form): doesn't move the row to In progress</label>` : ''}
            <div class="drop-zone">${dropZone()}</div>
            ${addKind === 'docs_received' && r.openRequests.length ? `<label class="check-line"><input type="checkbox" name="close" checked> Close the ${r.openRequests.length} open request${r.openRequests.length > 1 ? 's' : ''}</label>` : ''}
            <div class="row-end"><button class="btn ghost small" type="button" data-d="adding">Cancel</button><button class="btn primary small" type="submit">Add to timeline</button></div>
          </form>` : ''}
          <ol class="timeline">
            ${evs.length ? evs.map(ev => `
              <li class="ev k-${ev.kind}">
                <span class="ev-ico">${icon(EVENT_KINDS[ev.kind].icon, 15)}</span>
                <div class="ev-body">
                  <div class="ev-head"><b>${EVENT_KINDS[ev.kind].label}</b><span class="mono">${fmtDate(ev.event_date)}</span>${ev.party ? `<span>· ${esc(ev.party)}</span>` : ''}
                    <span class="src">${ev.source}</span>
                    ${ev.topic === 'form' ? '<span class="tag form">Form</span>' : ''}
                    ${ev.kind === 'docs_requested' ? ev.closed_on ? `<span class="tag ok">Received ${fmtDate(ev.closed_on)}</span>` : `<span class="tag w-${waitTone(r.openRequests.find(x => x.id === ev.id)?.days)}">Open · ${r.openRequests.find(x => x.id === ev.id)?.days ?? 0} d</span>` : ''}
                  </div>
                  ${ev.what ? `<div class="ev-what">${esc(ev.what)}</div>` : ''}
                  ${ev.note ? `<div class="ev-note">${esc(ev.note)}</div>` : ''}
                  ${thumbs(ev)}
                </div>
                <div class="ev-acts">
                  <button class="icon-btn small" data-d="attach" data-id="${ev.id}" aria-label="Add image" title="Add evidence image">${icon('image', 15)}</button>
                  ${ev.kind === 'docs_requested' && !ev.closed_on ? `<button class="btn soft small" data-d="close-req" data-id="${ev.id}">Received</button>` : ''}
                  ${ev.source !== 'scan' ? `<button class="icon-btn small" data-d="del-ev" data-id="${ev.id}" aria-label="Delete">${icon('trash', 15)}</button>` : ''}
                </div>
              </li>`).join('') : '<li class="empty">Nothing logged yet.</li>'}
          </ol>
          <input type="file" accept="image/*" multiple hidden data-file>
        </section>
        <details class="more-details"${detailsOpen ? ' open' : ''}>
          <summary>${icon('note', 16)} Details and file</summary>
          <div class="file-row">
          ${icon('file', 16)}<span class="mono clip">${r.fileName ? esc(r.fileName) : 'No comparison file yet'}</span>
          ${isDesktop() ? `${r.fileName ? `<button class="btn ghost small" data-d="open-file">Open file</button>` : ''}<button class="btn ghost small" data-d="open-folder">${icon('folder', 15)} Folder</button>` : ''}
        </div>
        <form class="fields" data-form="fields">
          <div class="field-row">
            ${field('candidate_name', 'Candidate', r.candidate, { file: f.has('candidate') })}
            ${field('manufacturer', 'Manufacturer', r.manufacturer, { file: f.has('manufacturer') })}
            ${field('supplier', 'Supplier / distributor', r.supplier, { file: f.has('supplier') })}
          </div>
          <div class="field-row">
            ${field('item_code', 'Item code', r.itemCode, { file: f.has('item_code') })}
            <label class="field">On the AVL${f.has('avl_listed') ? '<span class="from-file">from file</span>' : ''}
              <select name="avl_listed" ${f.has('avl_listed') ? 'disabled' : ''}>
                ${[['', 'Not checked'], ['true', 'Yes, already listed'], ['false', 'No, new source']].map(([v, l]) => `<option value="${v}"${String(r.avl ?? '') === v ? ' selected' : ''}>${l}</option>`).join('')}
              </select></label>
            <label class="field">Material type${f.has('kind') ? '<span class="from-file">from file</span>' : ''}
              <select name="kind" ${f.has('kind') ? 'disabled' : ''}>
                ${[['', 'Not set'], ['api', 'API'], ['excipient', 'Excipient']].map(([v, l]) => `<option value="${v}"${(r.kind || '') === v ? ' selected' : ''}>${l}</option>`).join('')}
              </select></label>
          </div>
          ${field('next_action', 'Next action', r.nextAction, { file: f.has('next_action') })}
          <label class="field">Notes<textarea name="notes" rows="2">${esc(r.raw.notes || '')}</textarea></label>
          <div class="row-end"><button class="btn soft small" type="submit">Save details</button></div>
        </form>
        </details>
      </div>`
  }

  el.addEventListener('toggle', e => { if (e.target.matches('.more-details')) detailsOpen = e.target.open }, true)

  el.addEventListener('change', async e => {
    if (e.target.name === 'kind' && e.target.closest('[data-form="event"]')) { addKind = e.target.value; draw(); return }
    if (e.target.name?.startsWith('st-')) {
      const key = e.target.name.slice(3)
      const values = key === 'outcome' ? OUTCOMES : STAGES.find(s => s.key === key).values
      const word = values.find(([v]) => String(v) === e.target.value)?.[1]
      try { await save({ [COLUMN[key]]: parseValue(e.target.value) }, `${key === 'outcome' ? 'Outcome' : STAGES.find(s => s.key === key).label}: ${word}`) } catch (err) { toast(err.message) }
      return
    }
    if (e.target.matches('[data-file]')) {
      const files = imagesOf(e.target.files)
      e.target.value = ''
      if (!files.length) return
      const ev = attachTo && state.data.events.find(x => x.id === attachTo)
      if (!ev) return addPending(files)
      try { await attach(ev, files); toast(files.length > 1 ? `${files.length} images added` : 'Image added') } catch (err) { toast(err.message) }
    }
  })

  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-d]')
    if (!b) return
    const r = state.rows.find(x => x.id === id)
    try {
      switch (b.dataset.d) {
        case 'adding': adding = !adding; if (!adding) clearPending(); return draw()
        case 'full': m.close(); return hooks.openFull?.(id)
        case 'accept': return await save(stampToStages(b.dataset.value), `Set ${SUGGEST[b.dataset.value]}`)
        case 'clear-stage': return await save({ [COLUMN[b.dataset.value]]: null })
        case 'close-req': {
          const reqId = b.dataset.id
          replace(state.data.events, await updateEvent(reqId, { closed_on: todayIso() }))
          toast('Marked received', { label: 'Undo', run: async () => {
            try { replace(state.data.events, await updateEvent(reqId, { closed_on: null })); changed() } catch (err) { toast(err.message) }
          } })
          return changed()
        }
        case 'del-ev': {
          const imgs = evidenceOf(b.dataset.id)
          if (!await confirmBox(imgs.length ? `Delete this timeline entry and its ${imgs.length} image${imgs.length > 1 ? 's' : ''}?` : 'Delete this timeline entry?')) return
          await deleteEvent(b.dataset.id, imgs)
          state.data.events = state.data.events.filter(x => x.id !== b.dataset.id)
          state.data.evidence = (state.data.evidence || []).filter(x => x.event_id !== b.dataset.id)
          return changed()
        }
        case 'attach': attachTo = b.dataset.id; return el.querySelector('[data-file]').click()
        case 'pick-img': attachTo = null; return el.querySelector('[data-file]').click()
        case 'unpend': URL.revokeObjectURL(pending[+b.dataset.value].url); pending.splice(+b.dataset.value, 1); return drawPending()
        case 'view-img': {
          const row = (state.data.evidence || []).find(x => x.id === b.dataset.id)
          if (row && urls[row.path]) viewImage(row, urls[row.path], () => { state.data.evidence = state.data.evidence.filter(x => x.id !== row.id); changed() })
          return
        }
        case 'open-file': return await window.electronAPI.openPath({ root: state.prefs.root, rel: `${r.folder}/${r.fileName}` })
        case 'open-folder': return await window.electronAPI.openPath({ root: state.prefs.root, rel: r.folder })
      }
    } catch (err) { toast(err.message || String(err)) }
  })

  el.addEventListener('submit', async e => {
    e.preventDefault()
    const r = state.rows.find(x => x.id === id)
    const fd = new FormData(e.target)
    const btn = e.target.querySelector('[type=submit]')
    btn.disabled = true
    try {
      if (e.target.dataset.form === 'fields') {
        const patch = {}
        for (const k of ['candidate_name', 'manufacturer', 'supplier', 'item_code', 'next_action', 'notes']) if (fd.has(k)) patch[k] = fd.get(k).trim() || null
        if (fd.has('avl_listed')) patch.avl_listed = fd.get('avl_listed') === '' ? null : fd.get('avl_listed') === 'true'
        replace(state.data.evaluations, await updateEvaluation(id, patch))
        if (fd.has('kind') && (fd.get('kind') || null) !== (r.material.kind || null)) replace(state.data.materials, await updateMaterial(r.material.id, { kind: fd.get('kind') || null }))
        toast('Saved')
      } else {
        const kind = fd.get('kind')
        const ev = await addEvent({ material_id: r.material.id, evaluation_id: id, kind, event_date: fd.get('event_date'),
          what: fd.get('what').trim() || null, party: fd.get('party').trim() || null, note: fd.get('note').trim() || null,
          topic: kind === 'docs_requested' && fd.get('topic_form') ? 'form' : null })
        state.data.events.push(ev)
        if (pending.length) { await attach(ev, pending.map(p => p.file)); clearPending() }
        if (kind === 'docs_received' && fd.get('close')) {
          for (const q of r.openRequests) replace(state.data.events, await updateEvent(q.id, { closed_on: ev.event_date }))
        }
        adding = false
        toast(`${EVENT_KINDS[kind].label} logged`)
      }
      changed()
    } catch (err) { toast(err.message); btn.disabled = false }
  })

  // A pasted or dropped screenshot goes with the entry being added.
  el.addEventListener('paste', e => {
    if (!adding) return
    const files = imagesOf(e.clipboardData?.items || [])
    if (files.length) { e.preventDefault(); addPending(files) }
  })
  el.addEventListener('dragover', e => { if (adding && e.target.closest('.add-event')) e.preventDefault() })
  el.addEventListener('drop', e => {
    if (!adding || !e.target.closest('.add-event')) return
    e.preventDefault()
    const files = imagesOf(e.dataTransfer?.files || [])
    if (files.length) addPending(files)
  })

  draw()
  loadUrls()
}
