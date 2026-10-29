// Screenshots of the running app for design checks (no browser needed).
// Usage: npm run demo, then: npm run shots -- shots.json
// shots.json: {"url":"http://localhost:5173/","out":".shots","jobs":[{"name","w","h","js"?,"full"?,"theme"?}]}
// Note: Electron exits if given a URL plus other CLI args, so everything
// lives in the JSON file. Transitions are disabled: hidden windows don't
// advance them, so modals would otherwise be captured at opacity 0.
const { app, BrowserWindow } = require('electron')
const fs = require('fs'), path = require('path')
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {}) // keep running between jobs
const cfg = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'))
const sleep = ms => new Promise(r => setTimeout(r, ms))
app.whenReady().then(async () => {
  for (const j of cfg.jobs) {
    const win = new BrowserWindow({ width: j.w, height: j.h, show: false })
    win.webContents.on('console-message', e => { if (e.level === 'error') console.log(`[${j.name}]`, e.message) })
    const load = async () => { for (let i = 0; i < 4; i++) { try { await win.loadURL(cfg.url); return } catch { await sleep(500) } } }
    await load()
    await win.webContents.executeJavaScript(`localStorage.setItem('vt_prefs', JSON.stringify(${JSON.stringify({ theme: j.theme || 'light', palette: j.palette || 'ink' })}))`)
    await load()
    await win.webContents.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important}')
    await sleep(900)
    if (j.js) { try { const r = await win.webContents.executeJavaScript(j.js); if (r !== undefined) console.log(j.name, '=>', r) } catch (e) { console.log(j.name, 'js error', e.message) } await sleep(700) }
    if (j.full) {
      const h = await win.webContents.executeJavaScript(`Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)`)
      win.setContentSize(j.w, Math.min(h, 3200)); await sleep(500)
    }
    // hidden windows can skip repainting the main layer after a scroll
    win.webContents.invalidate(); await sleep(300)
    fs.writeFileSync(path.join(cfg.out, j.name + '.png'), (await win.webContents.capturePage()).toPNG())
    console.log('saved', j.name)
    win.destroy()
  }
  app.quit()
})
