import { state } from '../store.js'
import { fmtDate } from '../model.js'
import { esc, icon } from '../ui.js'
import { viewLink, evalHash } from '../parts.js'

const isDesktop = () => !!window.electronAPI?.isElectron

export function scanSummary(run) {
  if (!run) return 'Never scanned'
  const when = new Date(run.finished_at || run.started_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  if (run.ok === false) return `Last scan failed ${when}: ${run.error || 'unknown error'}`
  if (!run.finished_at) return `Scan started ${when}…`
  return `${when} · ${run.trigger} · ${run.materials} materials, ${run.evaluations} evaluations, ${run.events_added} new document folders`
}

// One secret link shows everything, read-only; an evaluation's link is the
// same link plus its address. Revoking stops every copy.
function shareBlock() {
  if (state.shares === null) return '<p class="muted">Loading…</p>'
  if (state.shares.error) return `<p class="muted">${esc(state.shares.error)}</p>`
  const s = state.shares[0]
  if (!s) return `<p class="muted">Managers open Vetted read-only from a link, no sign-in. They see everything (prices, suppliers, timeline, documents) but can't change anything.</p>
    <div class="row-gap"><button class="btn primary small" data-act="share-create">${icon('link', 15)} Make the link</button></div>`
  return `<p class="muted">Anyone with this link sees everything in Vetted, read-only. Each evaluation's Hand off menu copies a link straight to that evaluation.</p>
    <div class="share-row"><code class="clip">${esc(viewLink())}</code><button class="btn soft small" data-act="share-copy">${icon('copy', 14)} Copy</button></div>
    <p class="muted small">Made ${fmtDate(s.created_at.slice(0, 10))}.</p>
    <div class="row-gap"><button class="btn ghost small danger-text" data-act="share-revoke" data-value="${esc(s.token)}">Turn it off and make a new one</button></div>`
}

// QA's AVL as the last scan read it: close matches to settle once, and
// approvals QA hasn't listed yet.
function avlBlock() {
  const rows = state.rows.filter(r => r.avlMatch)
  if (!rows.length) return `<p class="muted">Each scan reads QA's Approved Vendor List (FR-QA-PC-055 on Z:, read-only) and marks every candidate Listed (this material from this manufacturer is on it) or Not listed. Nothing read yet: run a scan from the desktop app with Z: connected${state.rows.length ? ', after the v0.7.2 SQL in supabase/SETUP.md' : ''}.</p>`
  const name = r => `${esc(r.materialName)}${r.grade ? ` ${esc(r.grade)}` : ''}${r.candidate ? ` · ${esc(r.candidate)}` : ''}`
  const asOf = rows.map(r => r.avlMatch.file_date).filter(Boolean).sort().pop()
  const n = v => rows.filter(r => r.avlListed === v).length
  const review = rows.filter(r => r.avlListed == null && r.avlMatch.review?.length)
  const unnamed = rows.filter(r => r.avlListed == null && !r.avlMatch.review?.length)
  return `<p class="muted">Read from FR-QA-PC-055 on every scan, read-only${asOf ? `; the list was last changed ${fmtDate(asOf)}` : ''}. ${n(true)} listed, ${n(false)} not listed. A value you set on the AVL station always wins.</p>
    ${review.length ? `<h3 class="avl-h">Close matches: is this the same source? <span class="count">${review.length}</span></h3>
      <ul class="avl-list">${review.map(r => `<li><a href="${evalHash(r.id)}">${name(r)}</a>
        <span class="muted small">${r.avlMatch.review.map(x => `${esc(x.manufacturer)} · ${esc(x.material)}${x.date ? ` · ${fmtDate(x.date)}` : ''}${x.active ? '' : ' · cancelled'}`).join('<br>')}</span>
        <span class="avl-acts"><button class="btn soft small" data-act="avl-set" data-id="${r.id}" data-value="true">Listed</button><button class="btn soft small" data-act="avl-set" data-id="${r.id}" data-value="false">Not listed</button></span></li>`).join('')}</ul>` : ''}
    ${unnamed.length ? `<p class="muted small">No manufacturer name to match for ${unnamed.map(r => `<a href="${evalHash(r.id)}">${name(r)}</a>`).join(', ')}. Add it on the evaluation page, or set the AVL station there.</p>` : ''}`
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
          <label class="check-line" style="margin-top:12px"><input type="checkbox" id="upload-files" ${state.prefs.uploadFiles ? 'checked' : ''}> Upload each candidate's latest Selection Form and CoA, so the web and view links can show them</label>
          <div class="row-gap" style="margin-top:12px"><button class="btn primary small" data-act="scan">${icon('sync', 15)} Re-scan now</button></div>`
          : `<p class="muted">Scans read the folder on the work PC, so they run from the desktop app or the daily scheduled task. This page shows the result of the last one.</p>`}
      </section>

      <section class="card">
        <div class="card-head"><h2>${icon('eye', 18)} Manager view link</h2></div>
        ${shareBlock()}
      </section>

      <section class="card avl-card">
        <div class="card-head"><h2>${icon('check', 18)} QA's AVL</h2></div>
        ${avlBlock()}
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
        <pre class="sql">node scripts/rm-log.js message   --material "<material>" --candidate "<candidate>" --party "PU" --note "CoA Missing; asked for GMP + MSDS"
node scripts/rm-log.js requested --material "<material>" --candidate "<candidate>" --what "GMP, MSDS" --party "PU" --image "<screenshot.png>"
node scripts/rm-log.js received  --material "<material>" --candidate "<candidate>" --what "GMP" --close all
node scripts/rm-log.js verdict   --material "<material>" --candidate "<candidate>" --coa missing --what "<one-line reason>"
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
