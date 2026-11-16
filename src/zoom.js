// Zoom and pan for one image inside a fixed-size stage: scroll wheel zooms
// around the pointer, drag moves a zoomed image, two fingers pinch, and a
// double-click (or double-tap) toggles between fitted and 2.5×. The image
// starts fitted (whole image visible); panning stops at its edges.
export function zoomable(stage, img, { max = 8 } = {}) {
  let s = 1, x = 0, y = 0
  const pts = new Map()
  let pinch = null

  const apply = () => {
    img.style.transform = `translate(${x}px, ${y}px) scale(${s})`
    stage.classList.toggle('zoomed', s > 1.001)
  }
  const clamp = () => {
    if (s <= 1.001) { s = 1; x = 0; y = 0; return }
    const r = stage.getBoundingClientRect()
    const mx = Math.max(0, (img.offsetWidth * s - r.width) / 2)
    const my = Math.max(0, (img.offsetHeight * s - r.height) / 2)
    x = Math.min(mx, Math.max(-mx, x))
    y = Math.min(my, Math.max(-my, y))
  }
  // Zoom to `next`, keeping the image point under (cx, cy) where it is.
  const zoomAt = (next, cx, cy) => {
    next = Math.min(max, Math.max(1, next))
    const r = stage.getBoundingClientRect()
    const px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2)
    x = px - (next / s) * (px - x)
    y = py - (next / s) * (py - y)
    s = next
    clamp(); apply()
  }
  const reset = () => { s = 1; x = 0; y = 0; apply() }

  stage.addEventListener('wheel', e => {
    e.preventDefault()
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
    zoomAt(s * Math.exp(-dy * 0.0016), e.clientX, e.clientY)
  }, { passive: false })

  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    try { stage.setPointerCapture(e.pointerId) } catch {}
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pts.size === 2) {
      const [a, b] = [...pts.values()]
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
    }
    if (s > 1) stage.classList.add('dragging')
  })
  stage.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    p.x = e.clientX; p.y = e.clientY
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
      x += mx - pinch.mx; y += my - pinch.my
      zoomAt(s * (d / (pinch.d || d)), mx, my)
      pinch = { d, mx, my }
    } else if (pts.size === 1 && s > 1) {
      x += dx; y += dy
      clamp(); apply()
    }
  })
  const up = e => {
    pts.delete(e.pointerId)
    if (pts.size < 2) pinch = null
    if (!pts.size) stage.classList.remove('dragging')
  }
  stage.addEventListener('pointerup', up)
  stage.addEventListener('pointercancel', up)
  stage.addEventListener('dblclick', e => { if (s > 1) reset(); else zoomAt(2.5, e.clientX, e.clientY) })
  img.draggable = false
  img.addEventListener('load', reset)

  return {
    reset,
    zoomBy: f => { const r = stage.getBoundingClientRect(); zoomAt(s * f, r.left + r.width / 2, r.top + r.height / 2) },
  }
}
