const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')
const { autoUpdater } = require('electron-updater')

app.setAppUserModelId(app.isPackaged ? 'com.apm.vetted' : 'com.apm.vetted.dev')
if (!app.requestSingleInstanceLock()) app.quit()

const isDev = process.argv.includes('--dev')
let mainWindow = null

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
const lib = name => import(pathToFileURL(path.join(__dirname, 'lib', name)).href)
let lastRoot = null

ipcMain.handle('scan:run', async (_e, { url, key, token, root }) => {
  const [{ scanFolder, DEFAULT_ROOT }, { pushScan }, { createClient }] = await Promise.all([lib('scanner.js'), lib('sync.js'), import('@supabase/supabase-js')])
  lastRoot = root || DEFAULT_ROOT
  const scan = scanFolder(lastRoot)
  const supa = createClient(url, key, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  return pushScan(supa, scan, 'desktop')
})

// Opens a comparison file or folder (path relative to the RM folder) in its default app.
ipcMain.handle('file:open', async (_e, { root, rel }) => {
  const { DEFAULT_ROOT } = await lib('scanner.js')
  const base = path.resolve(root || lastRoot || DEFAULT_ROOT)
  const target = path.resolve(base, rel)
  if (!target.startsWith(base)) throw new Error('Path is outside the RM folder')
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
  createWindow()
  if (!isDev) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000)
})
app.on('window-all-closed', () => app.quit())
