// Renders public/favicon.svg into the PNG/ICO icons (Chromium does the SVG
// rendering, so no image library needed).
// Usage: npm run icons
const { app, BrowserWindow } = require('electron')
const fs = require('fs'), path = require('path')

app.disableHardwareAcceleration()
const root = path.join(__dirname, '..')
const svg = fs.readFileSync(path.join(root, 'public', 'favicon.svg'), 'utf8')
// Full-bleed variant (square corners, mark scaled into the 80% safe zone)
// for the maskable + Apple icons, which the OS crops itself.
const bleed = svg.replace('rx="120"', 'rx="0"').replace('scale(15.5)', 'scale(12.4)')

async function render(win, markup, size) {
  const html = `<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body></html>`
  await win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html))
  await new Promise(r => setTimeout(r, 250))
  return win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
}

function ico(pngs) {
  const sizes = Object.keys(pngs).map(Number).sort((a, b) => a - b)
  const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
  let offset = 6 + 16 * sizes.length
  const dir = [], data = []
  for (const s of sizes) {
    const e = Buffer.alloc(16)
    e.writeUInt8(s >= 256 ? 0 : s, 0); e.writeUInt8(s >= 256 ? 0 : s, 1)
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[s].length, 8); e.writeUInt32LE(offset, 12)
    offset += pngs[s].length; dir.push(e); data.push(pngs[s])
  }
  return Buffer.concat([header, ...dir, ...data])
}

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, useContentSize: true })
  const big = await render(win, svg, 512)
  const out = (name, img) => { fs.writeFileSync(path.join(root, name), img.toPNG()); console.log('wrote', name) }
  out('public/icon-512.png', big)
  out('public/icon-192.png', big.resize({ width: 192, height: 192, quality: 'best' }))
  const full = await render(win, bleed, 512)
  out('public/icon-maskable-512.png', full)
  out('public/apple-touch-icon.png', full.resize({ width: 180, height: 180, quality: 'best' }))
  const pngs = {}
  for (const s of [16, 24, 32, 48, 64, 128, 256]) pngs[s] = big.resize({ width: s, height: s, quality: 'best' }).toPNG()
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), ico(pngs))
  console.log('wrote assets/icon.ico')
  app.quit()
})
