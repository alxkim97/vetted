// One evaluation: verdict, editable fields, and the timeline with an add form.
import { state, rebuild, cacheData } from './store.js'
import { STATUS, STAMP_KEYS, EVENT_KINDS, fmtDate, todayIso, waitTone } from './model.js'
import { updateEvaluation, updateMaterial, addEvent, updateEvent, deleteEvent } from './data.js'
import { esc, icon, openModal, toast, confirmBox } from './ui.js'
import { pill } from './views/register.js'

const isDesktop = () => !!window.electronAPI?.isElectron
const replace = (list, row) => { const i = list.findIndex(x => x.id === row.id); if (i >= 0) list[i] = row; else list.push(row) }

export function openDetail(id, onChange) {
  const m = openModal('<div class="detail"></div>', { wide: true })
  const el = m.el.querySelector('.detail')
  let addKind = 'message_sent'
  let adding = false        // add-entry form folded until asked for
  let detailsOpen = false

  const changed = () => { rebuild(); cacheData(); onChange(); draw() }

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
        <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
      </div>
      <div class="modal-body">
        ${r.verdictLine ? `<blockquote class="verdict">${esc(r.verdictLine)}</blockquote>` : r.fileName ? `<p class="muted small">No verdict line in this file (older format, verdict only in the count table).</p>` : ''}
        ${r.suggested ? `<div class="suggest">${icon('sparkle', 16)} The verdict line says <b>${esc(STATUS[r.suggested].label)}</b>. <button class="btn soft small" data-d="accept" data-value="${r.suggested}">Use it</button></div>` : ''}

        <div>
          <span class="field-label">Stamp${f.has('stamp') ? '<span class="from-file">from file</span>' : ''}</span>
          <div class="choice">
            ${STAMP_KEYS.map(s => `<label class="choice-item t-${STATUS[s].tone}"><input type="radio" name="stamp" value="${s}" ${r.stamp === s ? 'checked' : ''} ${f.has('stamp') ? 'disabled' : ''}><span>${esc(STATUS[s].label)}</span></label>`).join('')}
            ${!f.has('stamp') && r.stamp ? `<button class="link small" data-d="clear-stamp">Clear</button>` : ''}
          </div>
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
              <label class="field">${addKind === 'verdict' ? 'Verdict' : 'Documents'}<input name="what" placeholder="${addKind === 'verdict' ? 'ขาด: GMP missing' : 'GMP, MSDS, 50 g sample'}"></label>
            </div>
            <label class="field">${addKind === 'message_sent' ? 'What was said' : 'Note'}<textarea name="note" rows="2" placeholder="${addKind === 'message_sent' ? 'CoA verdict and the next documents asked for' : ''}"></textarea></label>
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
                    ${ev.kind === 'docs_requested' ? ev.closed_on ? `<span class="tag ok">Received ${fmtDate(ev.closed_on)}</span>` : `<span class="tag w-${waitTone(r.openRequests.find(x => x.id === ev.id)?.days)}">Open · ${r.openRequests.find(x => x.id === ev.id)?.days ?? 0} d</span>` : ''}
                  </div>
                  ${ev.what ? `<div class="ev-what">${esc(ev.what)}</div>` : ''}
                  ${ev.note ? `<div class="ev-note">${esc(ev.note)}</div>` : ''}
                </div>
                <div class="ev-acts">
                  ${ev.kind === 'docs_requested' && !ev.closed_on ? `<button class="btn soft small" data-d="close-req" data-id="${ev.id}">Received</button>` : ''}
                  ${ev.source !== 'scan' ? `<button class="icon-btn small" data-d="del-ev" data-id="${ev.id}" aria-label="Delete">${icon('trash', 15)}</button>` : ''}
                </div>
              </li>`).join('') : '<li class="empty">Nothing logged yet.</li>'}
          </ol>
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
    if (e.target.name === 'stamp') {
      try { replace(state.data.evaluations, await updateEvaluation(id, { stamp: e.target.value })); toast(`Stamped ${STATUS[e.target.value].label}`); changed() } catch (err) { toast(err.message) }
    }
  })

  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-d]')
    if (!b) return
    const r = state.rows.find(x => x.id === id)
    try {
      switch (b.dataset.d) {
        case 'adding': adding = !adding; return draw()
        case 'accept': replace(state.data.evaluations, await updateEvaluation(id, { stamp: b.dataset.value })); toast(`Stamped ${STATUS[b.dataset.value].label}`); return changed()
        case 'clear-stamp': replace(state.data.evaluations, await updateEvaluation(id, { stamp: null })); return changed()
        case 'close-req': replace(state.data.events, await updateEvent(b.dataset.id, { closed_on: todayIso() })); toast('Marked received'); return changed()
        case 'del-ev':
          if (!await confirmBox('Delete this timeline entry?')) return
          await deleteEvent(b.dataset.id)
          state.data.events = state.data.events.filter(x => x.id !== b.dataset.id)
          return changed()
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
          what: fd.get('what').trim() || null, party: fd.get('party').trim() || null, note: fd.get('note').trim() || null })
        state.data.events.push(ev)
        if (kind === 'docs_received' && fd.get('close')) {
          for (const q of r.openRequests) replace(state.data.events, await updateEvent(q.id, { closed_on: ev.event_date }))
        }
        adding = false
        toast(`${EVENT_KINDS[kind].label} logged`)
      }
      changed()
    } catch (err) { toast(err.message); btn.disabled = false }
  })

  draw()
}
