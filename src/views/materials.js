// One row per material folder, with each candidate's stamp as a mini pill,
// then the BOM lines of the picked products that no evaluation covers yet.
import { state, materialInProject, hasProjects } from '../store.js'
import { STATUS, PROJECTS, fmtDate, productsFor, productNames, notEvaluated } from '../model.js'
import { esc, icon } from '../ui.js'
import { projectSeg } from './register.js'

export function renderMaterials() {
  const byMat = {}
  for (const r of state.rows) (byMat[r.material.id] ||= []).push(r)
  const docCount = {}
  for (const ev of state.data.events) if (ev.kind === 'docs_received') docCount[ev.material_id] = (docCount[ev.material_id] || 0) + 1
  const mats = state.data.materials.filter(materialInProject).sort((a, b) => a.name.localeCompare(b.name))
  // Product chips: one per product, dot = project, tooltip lists the item code (and grade).
  const prodCell = m => {
    const list = productsFor(m)
    if (!list.length) return '<span class="nil">No product linked yet</span>'
    return `<div class="chips prods">${productNames(list).map(n => {
      const g = state.projectOf[n]
      const codes = list.filter(p => p.name === n).map(p => [p.code, p.grade].filter(Boolean).join(' ')).filter(Boolean).join(' · ')
      return `<button class="chip-tag prod${g ? ` g-${g}` : ''}" data-act="product" data-value="${esc(n)}" title="${esc([PROJECTS[g], codes].filter(Boolean).join(' · '))}">${esc(n)}</button>`
    }).join('')}</div>`
  }
  return `
    ${hasProjects() ? `<div class="filters">${projectSeg()}<span class="legend">${Object.entries(PROJECTS).map(([k, l]) => `<span class="chip-tag g-${k}">${l}</span>`).join('')}</span></div>` : ''}
    <div class="sheet">
      <table class="grid">
        <thead><tr><th class="rn"></th><th class="c-mat">Material</th><th>Kind</th><th>Item codes</th><th>Candidates</th><th>Products</th><th class="c-num">Doc batches</th><th>Last activity</th></tr></thead>
        <tbody>
          ${mats.length ? mats.map((m, i) => {
            const rows = byMat[m.id] || []
            const codes = [...new Set(rows.map(r => r.itemCode).filter(Boolean))]
            const last = rows.map(r => r.lastActivity).filter(Boolean).sort().pop()
            return `<tr data-act="material" data-value="${esc(m.name)}" tabindex="0">
              <td class="rn">${i + 1}</td>
              <td class="c-mat"><div class="mat">${esc(m.name)}</div></td>
              <td>${m.kind ? `<span class="kind k-${m.kind}">${m.kind === 'api' ? 'API' : 'Excipient'}</span>` : '<span class="nil">—</span>'}</td>
              <td class="mono">${codes.length ? codes.map(esc).join('<br>') : '<span class="nil">—</span>'}</td>
              <td><div class="minis">${rows.length ? rows.map(r => `<span class="mini t-${STATUS[r.status].tone}" title="${esc(STATUS[r.status].label)}">${esc([r.grade, r.candidate].filter(Boolean).join(' · ') || 'Candidate not set')}</span>`).join('') : '<span class="nil">No evaluation yet</span>'}</div></td>
              <td class="c-prod">${prodCell(m)}</td>
              <td class="c-num"><span class="num">${docCount[m.id] || 0}</span></td>
              <td class="mono">${last ? fmtDate(last) : '<span class="nil">—</span>'}</td>
            </tr>`
          }).join('') : '<tr><td colspan="8" class="empty-row">No material in this group.</td></tr>'}
        </tbody>
      </table>
    </div>
    <p class="foot-note">Click a material to see its candidates in the Register, or a product to filter the Register by it. Products come from the July 2026 BOM pull and the Master Formulas cited in each evaluation; hover one for the item code.</p>
    ${notEvaluatedPanel()}`
}

// What's left: BOM lines of the picked group's products with no evaluation.
function notEvaluatedPanel() {
  const { project } = state.filter
  const prods = (state.data.products || []).filter(p => (!project || p.project === project) && p.bom?.length)
  if (!prods.length) return ''
  const items = notEvaluated(prods, state.data.materials)
  const open = items.filter(x => !x.note)
  const scope = project ? PROJECTS[project] : 'all products with a BOM'
  return `
    <section class="left-panel">
      <div class="left-head"><h2>Not evaluated yet</h2>
        <span class="muted">${open.length} material${open.length === 1 ? '' : 's'} in the BOMs of ${esc(scope)} (${prods.length} product${prods.length === 1 ? '' : 's'}) have no evaluation${items.length > open.length ? `, plus ${items.length - open.length} other codes of evaluated materials` : ''}.</span></div>
      <div class="sheet"><table class="grid">
        <thead><tr><th class="rn"></th><th>Item code</th><th class="c-mat">Material</th><th>Used in</th><th>Note</th></tr></thead>
        <tbody>${items.map((x, i) => `
          <tr class="${x.note ? 'related' : ''}">
            <td class="rn">${i + 1}</td>
            <td class="mono">${esc(x.code)}</td>
            <td class="c-mat"><div class="mat">${esc(x.name)}</div></td>
            <td><div class="chips prods">${x.products.map(n => `<span class="chip-tag${state.projectOf[n] ? ` g-${state.projectOf[n]}` : ''}">${esc(n)}</span>`).join('')}</div></td>
            <td>${x.note ? `<span class="sub2">${esc(x.note)}</span>` : `<span class="tchip t-missing">${icon('alert', 12)} Not started</span>`}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </section>`
}
