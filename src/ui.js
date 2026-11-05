// Small UI toolkit: escaping, icons, toast, confirm and the modal/sheet shell.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Lucide geometry, 24×24, stroke = currentColor.
const PATHS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  week: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4M8 13v4M12 13v4M16 13v4"/>',
  month: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/><circle cx="8" cy="14" r="1"/><circle cx="12" cy="14" r="1"/><circle cx="16" cy="14" r="1"/><circle cx="8" cy="18" r="1"/><circle cx="12" cy="18" r="1"/>',
  flask: '<path d="M9 3h6M10 3v6.5L4.5 19A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2L14 9.5V3"/><path d="M7 15h10"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  factory: '<path d="M2 20V9l6 4V9l6 4V4h6v16z"/><path d="M2 20h20"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  arrowUR: '<path d="M7 17 17 7M8 7h9v9"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  hourglass: '<path d="M6 2h12M6 22h12M7 2v4a5 5 0 0 0 10 0V2M7 22v-4a5 5 0 0 1 10 0v4"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
  flag: '<path d="M5 22V4M5 4h12l-2.5 4L17 12H5"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  sortDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  sortUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="3"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  train: '<rect x="5" y="3" width="14" height="14" rx="4"/><path d="M5 11h14M9 21l-2-3M15 21l2-3"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
}

export async function copyText(text, done = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(done) } catch { toast('Copy failed; select the text and copy it by hand') }
}

// Dropdown under a button: [{ label, act?, value?, on?, sep?, html?, hint? }].
// Items carry data-act/data-value, so main.js's click handler runs them; the
// menu closes on any click outside it, Escape, or after an item runs.
let menuEl = null
export function closeMenu() { if (!menuEl) return false; menuEl.remove(); menuEl = null; return true }
export function openMenu(anchor, items, { align = 'left', html } = {}) {
  const same = menuEl?.dataset.for === anchor.dataset.menu
  closeMenu()
  if (same) return
  menuEl = document.createElement('div')
  menuEl.className = 'menu'
  menuEl.dataset.for = anchor.dataset.menu || ''
  menuEl.setAttribute('role', 'menu')
  menuEl.innerHTML = html ?? items.map(it => it.sep ? '<hr>' : it.head ? `<p class="menu-head">${esc(it.head)}</p>`
    : `<button type="button" role="menuitem" class="menu-item${it.on ? ' on' : ''}" ${it.act ? `data-act="${it.act}"` : ''} ${it.value != null ? `data-value="${esc(it.value)}"` : ''} ${it.id ? `data-id="${esc(it.id)}"` : ''}>
        <span class="menu-check">${it.on ? icon('check', 14) : ''}</span><span>${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span></button>`).join('')
  document.body.append(menuEl)
  const r = anchor.getBoundingClientRect()
  const w = menuEl.offsetWidth
  const left = align === 'right' ? r.right - w : r.left
  menuEl.style.left = `${Math.max(8, Math.min(left, innerWidth - w - 8)) + scrollX}px`
  menuEl.style.top = `${r.bottom + 6 + scrollY}px`
  menuEl.querySelector('input, .menu-item')?.focus()
  return menuEl
}
document.addEventListener('mousedown', e => { if (menuEl && !menuEl.contains(e.target) && !e.target.closest('[data-menu]')) closeMenu() })

export const icon = (name, size = 20) =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`

let toastEl, toastTimer
export function toast(msg, action) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.append(toastEl) }
  toastEl.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`
  if (action) toastEl.querySelector('button').onclick = () => { hide(); action.run() }
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  const hide = () => toastEl.classList.remove('show')
  toastTimer = setTimeout(hide, action ? 5000 : 2400)
}

// Modal on desktop, bottom sheet on phone (same markup; CSS decides).
// Returns { el, close }. Escape and a backdrop click close it.
const stack = []
export function openModal(html, { onClose, wide } = {}) {
  const overlay = document.createElement('div')
  overlay.className = 'overlay'
  overlay.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`
  document.body.append(overlay)
  void overlay.offsetHeight // commit the closed state so the open transition runs
  overlay.classList.add('open')
  const prevFocus = document.activeElement
  const close = () => {
    if (!overlay.isConnected) return
    stack.splice(stack.indexOf(entry), 1)
    overlay.classList.remove('open')
    setTimeout(() => overlay.remove(), 180)
    prevFocus?.focus?.()
    onClose?.()
  }
  const entry = { close }
  stack.push(entry)
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close() })
  overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close))
  return { el: overlay.querySelector('.modal'), close }
}
export const closeTopModal = () => { const top = stack[stack.length - 1]; if (top) { top.close(); return true } return false }
export const modalOpen = () => stack.length > 0

export function confirmBox(message, { ok = 'Delete', danger = true } = {}) {
  return new Promise(resolve => {
    let answered = false
    const m = openModal(`
      <div class="confirm">
        <p>${esc(message)}</p>
        <div class="row-end">
          <button class="btn ghost" data-close>Cancel</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button>
        </div>
      </div>`, { onClose: () => { if (!answered) resolve(false) } })
    m.el.querySelector('[data-ok]').onclick = () => { answered = true; resolve(true); m.close() }
    m.el.querySelector('[data-ok]').focus()
  })
}
