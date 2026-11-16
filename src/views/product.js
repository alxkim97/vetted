// One product's formula (rm_products.bom, in BOM order) with every evaluation
// done for each ingredient. Opened from a product chip on an evaluation page.
import { state } from '../store.js'
import { PROJECTS, STATUS } from '../model.js'
import { esc, icon, openModal } from '../ui.js'
import { pill } from '../parts.js'

const hrefOf = r => `${state.viewToken ? `#/v/${state.viewToken}` : '#'}/e/${r.id.slice(0, 8)}`
const byStatus = (a, b) => STATUS[a.status].order - STATUS[b.status].order || (a.candidate || '').localeCompare(b.candidate || '')

// Evaluations that list this product, grouped by the item code they list it under.
function evalsByCode(name) {
  const out = new Map()
  for (const r of state.rows) for (const p of r.products) {
    if (p.name !== name) continue
    const k = p.code || ''
    if (!out.has(k)) out.set(k, [])
    if (!out.get(k).includes(r)) out.get(k).push(r)
  }
  return out
}

const evalLine = r => `
  <a class="pf-eval" href="${hrefOf(r)}" data-close>
    <span class="pf-who">${esc([r.grade, r.candidate || 'Current source'].filter(Boolean).join(' · '))}${r.manufacturer && r.manufacturer !== r.candidate ? `<small>${esc(r.manufacturer)}</small>` : ''}</span>
    ${pill(r)}
  </a>`

export function openProduct(name) {
  const p = (state.data.products || []).find(x => x.name === name)
  const evals = evalsByCode(name)
  const bom = p?.bom || []
  const lines = bom.map(([code, label, note]) => ({ code, label, note, rows: (evals.get(code) || []).slice().sort(byStatus) }))
  const inBom = new Set(bom.map(b => b[0]))
  // Evaluated for this product but not on its BOM (no formula loaded, or another code).
  const extra = [...evals.entries()].filter(([code]) => !inBom.has(code)).flatMap(([, rows]) => rows).sort(byStatus)
  const done = lines.filter(l => l.rows.length).length
  const open = [...lines.flatMap(l => l.rows), ...extra].filter(r => !['approved', 'not_approved', 'closed'].includes(r.status)).length

  const body = bom.length ? `
    <ol class="pf-bom">${lines.map(l => `
      <li class="pf-line${l.rows.length ? '' : ' none'}">
        <div class="pf-ing"><span class="pf-code">${esc(l.code)}</span><b>${esc(l.label)}</b>${l.note ? `<small>${esc(l.note)}</small>` : ''}</div>
        <div class="pf-evals">${l.rows.length ? l.rows.map(evalLine).join('') : '<span class="pf-none">Not evaluated</span>'}</div>
      </li>`).join('')}
    </ol>` : `<p class="pf-empty">The formula for ${esc(name)} isn't loaded in Vetted yet${p?.code ? ` (${esc(p.code)})` : ''}.</p>`

  openModal(`
    <div class="modal-head pf-head">
      <div>
        <p class="eyebrow">${[p?.code ? `FG ${esc(p.code)}` : '', p ? esc(PROJECTS[p.project] || '') : ''].filter(Boolean).join(' · ') || 'Product'}</p>
        <h2>${esc(name)}</h2>
        <p class="pf-sum">${bom.length ? `${bom.length} ingredients · ${done} evaluated` : 'Formula not loaded'}${open ? ` · ${open} still open` : ''}</p>
      </div>
      <button class="icon-btn" data-close aria-label="Close">${icon('x', 18)}</button>
    </div>
    <div class="pf-body">
      ${body}
      ${extra.length ? `<p class="pf-sub">${bom.length ? 'Also evaluated for this product' : 'Evaluated for this product'}</p><div class="pf-evals pf-extra">${extra.map(r => evalLine({ ...r, candidate: `${r.materialName}${r.candidate ? ` · ${r.candidate}` : ''}` })).join('')}</div>` : ''}
    </div>`, { wide: true })
}
