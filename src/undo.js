// Undo and redo for every edit made in the app (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y).
// An edit is recorded as { label, undo, redo }: two async functions that
// write to Supabase and patch state.data. Deleted image files stay in the
// bucket so an undo can bring them back; the next start removes any that no
// timeline entry uses any more (purgeOrphans).
import { toast } from './ui.js'

const past = []
const future = []
const LIMIT = 50
const PURGE_KEY = 'vt_purge'
export const hooks = { changed: () => {} }

export function record(entry) {
  past.push(entry)
  if (past.length > LIMIT) past.shift()
  future.length = 0
}

async function step(from, to, dir) {
  const entry = from.pop()
  if (!entry) return toast(dir === 'undo' ? 'Nothing to undo' : 'Nothing to redo')
  try {
    await entry[dir]()
    to.push(entry)
    hooks.changed()
    toast(`${dir === 'undo' ? 'Undone' : 'Redone'}: ${entry.label}`)
  } catch (err) {
    from.push(entry)
    hooks.changed()
    toast(`Couldn't ${dir}: ${err.message || err}`)
  }
}
export const undo = () => step(past, future, 'undo')
export const redo = () => step(future, past, 'redo')

// Image files whose rows were deleted; removed at the next start if still unused.
export function markForPurge(paths) {
  if (!paths.length) return
  try {
    const list = new Set(JSON.parse(localStorage.getItem(PURGE_KEY) || '[]'))
    paths.forEach(p => list.add(p))
    localStorage.setItem(PURGE_KEY, JSON.stringify([...list]))
  } catch {}
}
export async function purgeOrphans(inUse, remove) {
  let list
  try { list = JSON.parse(localStorage.getItem(PURGE_KEY) || '[]') } catch { return }
  const gone = list.filter(p => !inUse.has(p))
  if (!list.length) return
  try { await remove(gone); localStorage.removeItem(PURGE_KEY) } catch {}
}
