import { state } from '../store.js'
import { esc, icon } from '../ui.js'

const isDesktop = () => !!window.electronAPI?.isElectron

export function scanSummary(run) {
  if (!run) return 'Never scanned'
  const when = new Date(run.finished_at || run.started_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  if (run.ok === false) return `Last scan failed ${when}: ${run.error || 'unknown error'}`
  if (!run.finished_at) return `Scan started ${when}…`
  return `${when} · ${run.trigger} · ${run.materials} materials, ${run.evaluations} evaluations, ${run.events_added} new document folders`
}

export function renderSettings() {
  const run = state.data.lastRun
  return `
    <div class="settings">
      <section class="card">
        <div class="card-head"><h2>${icon('sync', 18)} Folder scan</h2></div>
        <p class="setting-line">${esc(scanSummary(run))}</p>
        ${isDesktop() ? `
          <label class="field">RM evaluation folder
            <input id="root" value="${esc(state.prefs.root)}" placeholder="Default: Everything\\APm Drug Files\\General\\Raw Material Evaluation Document"></label>
          <div class="row-gap" style="margin-top:12px"><button class="btn primary small" data-act="scan">${icon('sync', 15)} Re-scan now</button></div>`
          : `<p class="muted">Scans read the folder on the work PC, so they run from the desktop app or the daily scheduled task. This page shows the result of the last one.</p>`}
      </section>

      <section class="card">
        <div class="card-head"><h2>${icon('clock', 18)} Daily scheduled scan</h2></div>
        <p class="muted">One-time setup on the work PC, from the <code>vetted</code> folder (needs <code>.env.local</code>, see <code>supabase/SETUP.md</code>):</p>
        <pre class="sql">powershell -ExecutionPolicy Bypass -File scripts\\install-schedule.ps1 -Time 08:30</pre>
        <p class="muted">It runs every day at that time, or as soon as the PC is back on if it was off.</p>
      </section>

      <section class="card">
        <div class="card-head"><h2>${icon('message', 18)} Logging from a chat</h2></div>
        <p class="muted">A material chat records what it sent or asked for with one command, so the timeline fills in without typing here:</p>
        <pre class="sql">node scripts/rm-log.js message   --material "<material>" --candidate "<candidate>" --party "PU" --note "CoA ขาด; asked for GMP + MSDS"
node scripts/rm-log.js requested --material "<material>" --candidate "<candidate>" --what "GMP, MSDS" --party "PU"
node scripts/rm-log.js received  --material "<material>" --candidate "<candidate>" --what "GMP" --close all
node scripts/rm-log.js verdict   --material "<material>" --candidate "<candidate>" --stamp ขาด --what "<one-line reason>"
node scripts/rm-log.js open</pre>
      </section>

      <section class="card">
        <div class="card-head"><h2>${icon('moon', 18)} Appearance</h2></div>
        <div class="row-gap">
          <div class="seg">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button type="button" class="${state.prefs.theme === v ? 'on' : ''}" data-act="theme" data-value="${v}">${l}</button>`).join('')}</div>
        </div>
      </section>

      <section class="card">
        <p class="setting-line">Vetted v${__APP_VERSION__}${state.session?.user?.email ? ` · signed in as ${esc(state.session.user.email)}` : ''}</p>
        <div class="row-gap">
          ${isDesktop() ? `<button class="btn soft small" data-act="update">Check for updates</button>` : ''}
          <button class="btn ghost small" data-act="signout">${icon('logout', 15)} Sign out</button>
        </div>
      </section>
    </div>`
}
