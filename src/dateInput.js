// Date fields that always read dd-mm-yyyy, whatever the browser's or Windows'
// locale. A native <input type="date"> follows the system format (07/21/2026 on
// a US-set PC), so the field you type in is text, and the native picker sits
// hidden behind the calendar button. The ISO date the forms read lives in a
// hidden input under the field's name.

const pad = n => String(n).padStart(2, '0')

// '21-07-2026', '21/7/2026', '21.07.2026' → '2026-07-21'; anything else → null.
export function parseDmy(s) {
  const m = String(s ?? '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  if (!m) return null
  const [d, mo, y] = [+m[1], +m[2], +m[3]]
  const t = new Date(Date.UTC(y, mo - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null
  return `${y}-${pad(mo)}-${pad(d)}`
}

export const isoToDmy = iso => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '')

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const CAL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>'

// The control alone (put it inside a <label class="field">).
export function dmyInput(name, value, { max = null, required = true } = {}) {
  return `<span class="dmy" data-max="${max || ''}">` +
    `<input type="text" class="dmy-text" value="${esc(isoToDmy(value))}" placeholder="dd-mm-yyyy" inputmode="numeric" autocomplete="off" maxlength="10" ${required ? 'required' : ''} data-dmy aria-label="Date, dd-mm-yyyy">` +
    `<input type="hidden" name="${esc(name)}" value="${esc(value || '')}">` +
    `<button type="button" class="dmy-cal" data-dmy-cal tabindex="-1" aria-label="Pick a date">${CAL}</button>` +
    `<input type="date" class="dmy-native" tabindex="-1" aria-hidden="true" value="${esc(value || '')}"${max ? ` max="${max}"` : ''}>` +
    `</span>`
}

function sync(box, text) {
  const iso = parseDmy(text.value)
  const max = box.dataset.max
  const hidden = box.querySelector('input[type=hidden]')
  hidden.value = iso || ''
  text.setCustomValidity(!text.value.trim() && !text.required ? '' : !iso ? 'Use dd-mm-yyyy, e.g. 21-07-2026' : max && iso > max ? 'That date is in the future' : '')
  if (iso) box.querySelector('.dmy-native').value = iso
}

// One set of listeners for every dd-mm-yyyy field on the page.
let installed = false
export function installDmy(root = document) {
  if (installed) return
  installed = true
  root.addEventListener('input', e => {
    const t = e.target
    if (t.matches?.('[data-dmy]')) {
      // Type the digits only: 21072026 → 21-07-2026.
      const digits = t.value.replace(/\D/g, '')
      if (!/[-/.]/.test(t.value) && digits.length === 8) t.value = `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`
      sync(t.closest('.dmy'), t)
    } else if (t.matches?.('.dmy-native')) {
      const box = t.closest('.dmy'), text = box.querySelector('[data-dmy]')
      text.value = isoToDmy(t.value)
      sync(box, text)
    }
  })
  root.addEventListener('change', e => { if (e.target.matches?.('.dmy-native')) e.target.dispatchEvent(new Event('input', { bubbles: true })) })
  root.addEventListener('click', e => {
    const b = e.target.closest?.('[data-dmy-cal]')
    if (!b) return
    e.preventDefault()
    const n = b.closest('.dmy').querySelector('.dmy-native')
    try { n.showPicker() } catch { n.focus(); n.click() }
  })
}
