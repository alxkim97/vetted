import { signIn, signOut } from '../data.js'
import { esc } from '../ui.js'
import { stampMark } from '../theme.js'

const shell = inner => `
  <div class="auth">
    <div class="auth-card">
      <div class="brand big"><span class="logo">${stampMark(26)}</span><span>Vetted</span></div>
      ${inner}
    </div>
  </div>`

// Same account as WorkLog (same Supabase project).
export function renderAuth(root) {
  const draw = (msg = '') => {
    root.innerHTML = shell(`
      <p class="auth-sub">Every raw material evaluation in one grid. Sign in with your WorkLog account.</p>
      <form class="auth-form">
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        ${msg ? `<p class="auth-msg">${esc(msg)}</p>` : ''}
        <button class="btn primary block" type="submit">Sign in</button>
      </form>`)
    root.querySelector('form').onsubmit = async e => {
      e.preventDefault()
      const f = new FormData(e.target)
      e.target.querySelector('button').disabled = true
      try { await signIn(f.get('email'), f.get('password')) } catch (err) { draw(err.message || 'Could not sign in') }
    }
  }
  draw()
}

export function renderNotMember(root, user) {
  root.innerHTML = shell(`
    <h2>Not a member</h2>
    <p class="auth-sub">${esc(user.email)} isn't on the WorkLog member list, which Vetted shares. Add it there first (WorkLog's supabase/SETUP.md, block C).</p>
    <button class="link" data-out>Sign out</button>`)
  root.querySelector('[data-out]').onclick = () => signOut()
}

// Signed in and a member, but the rm_* tables don't exist yet.
export function renderNoTables(root, onRetry) {
  root.innerHTML = shell(`
    <h2>One step left</h2>
    <p class="auth-sub">The Vetted tables aren't in the worklog Supabase project yet. Run the SQL block in <code>supabase/SETUP.md</code> once in the SQL Editor, then retry.</p>
    <button class="btn primary" data-retry>I ran it</button>
    <button class="link" data-out>Sign out</button>`)
  root.querySelector('[data-retry]').onclick = onRetry
  root.querySelector('[data-out]').onclick = () => signOut()
}
