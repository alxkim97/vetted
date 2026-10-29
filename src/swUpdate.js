// Reload into a fresh deploy on first open (same approach as Coin): the new
// service worker takes control within seconds, then the page swaps to the
// new bundle — unless a dialog is open, in which case it waits until the app
// is next hidden so nothing half-typed is lost.
const RELOAD_KEY = 'vt_sw_reloaded_at'

export function initUpdateReload({ isBusy }) {
  if (!('serviceWorker' in navigator)) return
  let hadController = !!navigator.serviceWorker.controller
  let pending = false
  const reload = () => {
    try {
      if (Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) || 0) < 60_000) return
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    } catch {}
    location.reload()
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return }
    if (isBusy()) { pending = true; return }
    reload()
  })
  document.addEventListener('visibilitychange', () => { if (pending && document.visibilityState === 'hidden') reload() })
  navigator.serviceWorker.getRegistration().then(reg => { if (reg) setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000) }).catch(() => {})
}
