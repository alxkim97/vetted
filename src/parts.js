// Small pieces several views share: the status pill (hover = time in that
// status), the mini station line for table rows, names and links.
import { state } from './store.js'
import { STATUS, sinceText, fmtDate } from './model.js'
import { esc } from './ui.js'

export const pill = (r, cls = '') => `<span class="stamp t-${STATUS[r.status].tone}${cls ? ' ' + cls : ''}" data-tip="${esc(sinceText(r))}">${esc(STATUS[r.status].label)}</span>`
export const pillOf = s => `<span class="stamp t-${STATUS[s].tone}">${esc(STATUS[s].label)}</span>`

// One row's name: Material · grade · candidate.
export const who = r => [r.materialName, r.grade, r.candidate].filter(Boolean).map(esc).join(' · ')

const TONE = { green: 'green', amber: 'amber', red: 'red', slate: 'slate', grey: 'grey', ink: 'ink' }
// AVL → CoA → Docs → QC → Decision as dots on a line; the label names where it is now.
export function miniLine(r) {
  const now = r.stations.find(s => s.state === 'now')
  const dots = r.stations.map((s, i) => {
    const track = i ? `<s class="${s.state === 'ahead' ? 'ahead' : ''}"></s>` : ''
    const tone = s.state === 'now' ? r.status === 'in_progress' ? 'blue' : TONE[s.tone] || 'ink' : TONE[s.tone] || 'ink'
    return `${track}<i class="${s.state}${s.filled ? ' filled' : ''} t-${tone}" title="${esc(`${s.label}${s.result ? `: ${s.result}` : ''}${s.date ? ` · ${fmtDate(s.date)}` : ''}${s.basis ? ` · ${s.basis}` : ''}`)}"></i>`
  }).join('')
  return `<span class="mini-line" aria-label="At ${esc(now?.label || '')}">${dots}</span><span class="mini-at">${esc((now?.label || '').replace('QC sample', 'QC'))}</span>`
}

// The evaluation's own address, and the manager's view-only version of it.
export const shortId = id => id.slice(0, 8)
export const evalHash = (id, tab) => `#/e/${shortId(id)}${tab && tab !== 'summary' ? `/${tab}` : ''}`
export function viewLink(id) {
  const share = state.shares?.[0]
  if (!share) return null
  const base = location.protocol.startsWith('http') && !/localhost|127\.0\.0\.1/.test(location.host) ? `${location.origin}${location.pathname}` : 'https://vetted-jet.vercel.app/'
  return `${base}#/v/${share.token}${id ? `/e/${shortId(id)}` : ''}`
}
