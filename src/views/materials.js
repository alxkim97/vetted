// One row per material folder, with each candidate's stamp as a mini pill.
import { state } from '../store.js'
import { STATUS, fmtDate } from '../model.js'
import { esc, icon } from '../ui.js'

export function renderMaterials() {
  const byMat = {}
  for (const r of state.rows) (byMat[r.material.id] ||= []).push(r)
  const docCount = {}
  for (const ev of state.data.events) if (ev.kind === 'docs_received') docCount[ev.material_id] = (docCount[ev.material_id] || 0) + 1
  const mats = state.data.materials.slice().sort((a, b) => a.name.localeCompare(b.name))
  return `
    <div class="banner">${icon('box', 18)}<div><b>Products column is waiting on the BOM re-pull.</b>
      Once the BOMs are pulled again from MyDream, each material gets its product list and the Register gets a product filter.
      Until then nothing here is mapped to a medicine, on purpose.</div></div>
    <div class="sheet">
      <table class="grid">
        <thead><tr><th class="rn"></th><th class="c-mat">Material</th><th>Kind</th><th>Item codes</th><th>Candidates</th><th>Products</th><th class="c-num">Doc batches</th><th>Last activity</th></tr></thead>
        <tbody>
          ${mats.map((m, i) => {
            const rows = byMat[m.id] || []
            const codes = [...new Set(rows.map(r => r.itemCode).filter(Boolean))]
            const last = rows.map(r => r.lastActivity).filter(Boolean).sort().pop()
            return `<tr data-act="material" data-value="${esc(m.name)}" tabindex="0">
              <td class="rn">${i + 1}</td>
              <td class="c-mat"><div class="mat">${esc(m.name)}</div></td>
              <td>${m.kind ? `<span class="kind k-${m.kind}">${m.kind === 'api' ? 'API' : 'Excipient'}</span>` : '<span class="nil">—</span>'}</td>
              <td class="mono">${codes.length ? codes.map(esc).join('<br>') : '<span class="nil">—</span>'}</td>
              <td><div class="minis">${rows.length ? rows.map(r => `<span class="mini t-${STATUS[r.status].tone}" title="${esc(STATUS[r.status].label)}">${esc([r.grade, r.candidate].filter(Boolean).join(' · ') || 'Candidate not set')}</span>`).join('') : '<span class="nil">No evaluation yet</span>'}</div></td>
              <td><span class="nil">BOM pending</span></td>
              <td class="c-num"><span class="num">${docCount[m.id] || 0}</span></td>
              <td class="mono">${last ? fmtDate(last) : '<span class="nil">—</span>'}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
    <p class="foot-note">Click a material to see its candidates in the Register.</p>`
}
