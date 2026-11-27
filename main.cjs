const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron')
const { Readable } = require('stream')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const { autoUpdater } = require('electron-updater')

app.setAppUserModelId(app.isPackaged ? 'com.apm.vetted' : 'com.apm.vetted.dev')
if (!app.requestSingleInstanceLock()) app.quit()

const isDev = process.argv.includes('--dev')
let mainWindow = null

// vetted-file://doc/<path inside the RM folder> shows a document in the app's
// viewer (the Documents tab). Nothing outside the RM folder is served.
protocol.registerSchemesAsPrivileged([{ scheme: 'vetted-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Vetted',
    backgroundColor: '#f2f2f7',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true, // Chromium's PDF viewer for the Documents tab
    },
  })
  if (isDev) mainWindow.loadURL('http://localhost:5173')
  else mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'))
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })
}

// ── Folder scan ──────────────────────────────────────────────────────────
// lib/ is ESM (shared with scripts/scan.js), so it's loaded with import().
// The push runs as the signed-in user (their access token), so RLS applies
// exactly as it does in the app — no service key on this side.
// True when target is base itself or inside it (a plain prefix test would let a sibling like base + '2' through).
const within = (target, base) => target === base || target.startsWith(base + path.sep)
const lib = name => import(pathToFileURL(path.join(__dirname, 'lib', name)).href)
let lastRoot = null

ipcMain.handle('scan:run', async (_e, { url, key, token, root, upload }) => {
  const [{ scanFolder, DEFAULT_ROOT }, { pushScan }, { createClient }] = await Promise.all([lib('scanner.js'), lib('sync.js'), import('@supabase/supabase-js')])
  lastRoot = root || DEFAULT_ROOT
  const scan = scanFolder(lastRoot)
  const supa = createClient(url, key, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  return pushScan(supa, scan, 'desktop', { upload: !!upload })
})

async function rmRoot(root) {
  const { DEFAULT_ROOT } = await lib('scanner.js')
  return path.resolve(root || lastRoot || DEFAULT_ROOT)
}

// Saves a PDF made from the page's HTML (status list, evaluation summary).
// The status list gets the next free revision in the RM folder's own naming.
// The status list's name (with its R.n) comes from the app, which keeps the counter.
ipcMain.handle('pdf:save', async (_e, { html, name, fileName: given, rel, root }) => {
  const base = await rmRoot(root)
  const fileName = given ? path.basename(given) : name
  const dir = path.resolve(base, rel || '')
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(within(dir, base) && fs.existsSync(dir) ? dir : base, fileName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (canceled || !filePath) return null
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true })
    fs.writeFileSync(filePath, pdf)
  } finally { win.destroy() }
  shell.openPath(filePath)
  return filePath
})

// After a status list is saved: finds older revisions (R.n) in the same folder and, with
// move: true, shelves them in the sibling Old folder. Never overwrites or deletes.
ipcMain.handle('pdf:archive-older', async (_e, { filePath, root, move }) => {
  const base = await rmRoot(root)
  const file = path.resolve(filePath), dir = path.dirname(file)
  if (!within(dir, base)) return { files: [], revs: [] }
  const keep = path.basename(file)
  const older = fs.readdirSync(dir).filter(f => f !== keep && /^RM Evaluation Status List \(R\.\d+_.*\)\.(pdf|md)$/.test(f))
  const revs = [...new Set(older.map(f => Number(f.match(/\(R\.(\d+)_/)[1])))].sort((a, b) => a - b)
  if (!move) return { files: older, revs }
  const old = path.resolve(dir, '..', 'Old')
  if (!within(old, base) || !fs.existsSync(old)) throw new Error('No Old folder next to this one')
  let moved = 0, skipped = 0
  for (const f of older) {
    const to = path.join(old, f)
    if (fs.existsSync(to)) { skipped++; continue }
    fs.renameSync(path.join(dir, f), to); moved++
  }
  return { moved, skipped }
})

// Opens a comparison file or folder (path relative to the RM folder) in its default app.
ipcMain.handle('file:open', async (_e, { root, rel }) => {
  const { DEFAULT_ROOT } = await lib('scanner.js')
  const base = path.resolve(root || lastRoot || DEFAULT_ROOT)
  const target = path.resolve(base, rel)
  if (!within(target, base)) throw new Error('Path is outside the RM folder')
  const err = await shell.openPath(target)
  if (err) throw new Error(err)
})

// ── Updates (GitHub Releases) ────────────────────────────────────────────
autoUpdater.autoInstallOnAppQuit = true
autoUpdater.on('update-downloaded', info => {
  dialog.showMessageBox({
    type: 'info', title: 'Vetted update ready',
    message: `Vetted ${info.version} has been downloaded.`,
    detail: 'Restart now to install it, or it installs the next time Vetted quits.',
    buttons: ['Restart Now', 'Later'], defaultId: 0, cancelId: 1,
  }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall() })
})
autoUpdater.on('error', err => console.error('autoUpdater error:', err))

ipcMain.handle('updater:check', async () => {
  if (isDev) return 'skipped-dev'
  try {
    const r = await autoUpdater.checkForUpdates()
    const v = r?.updateInfo?.version
    dialog.showMessageBox({ type: 'info', title: 'Vetted', message: v && v !== app.getVersion() ? `Update found: ${v}. Downloading now.` : "You're up to date." })
  } catch (err) {
    dialog.showMessageBox({ type: 'error', title: 'Update check failed', message: String(err?.message || err) })
  }
})
ipcMain.handle('app:get-version', () => app.getVersion())

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})
app.whenReady().then(() => {
  protocol.handle('vetted-file', async req => {
    const base = await rmRoot(null)
    const rel = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''))
    const target = path.resolve(base, rel)
    if (!target.startsWith(base + path.sep)) return new Response('Outside the RM folder', { status: 403 })
    if (!fs.existsSync(target)) return new Response('Not found', { status: 404 })
    // Streamed straight from disk: Chromium's file:// fetch failed on some file names.
    const type = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[path.extname(target).toLowerCase()] || 'application/octet-stream'
    return new Response(Readable.toWeb(fs.createReadStream(target)), { headers: { 'content-type': type } })
  })
  createWindow()
  if (!isDev) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000)
})
app.on('window-all-closed', () => app.quit())
