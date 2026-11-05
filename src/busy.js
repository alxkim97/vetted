// A thin moving bar at the top while anything is loading or saving, so a
// slow network never looks like a frozen app. Counts every fetch (Supabase,
// the view link, signed file links); shows only if one takes over 250 ms.
// Imported before data.js so the Supabase client picks up the wrapped fetch.
let open = 0, timer = null, bar = null
const show = () => {
  if (!bar) { bar = document.createElement('div'); bar.className = 'busy-bar'; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Working'); document.body.append(bar) }
  bar.classList.add('on')
}
const hide = () => { clearTimeout(timer); timer = null; bar?.classList.remove('on') }

const base = window.fetch.bind(window)
window.fetch = async (...args) => {
  if (open++ === 0) timer = setTimeout(show, 250)
  try { return await base(...args) } finally { if (--open === 0) hide() }
}
