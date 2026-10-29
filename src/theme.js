// 'system' leaves data-theme off so the prefers-color-scheme block applies.
export function applyTheme(mode) {
  const el = document.documentElement
  if (mode === 'light' || mode === 'dark') el.setAttribute('data-theme', mode)
  else el.removeAttribute('data-theme')
  requestAnimationFrame(() => {
    const bg = getComputedStyle(el).getPropertyValue('--bg').trim()
    if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
  })
}

// The stamp mark: an ink ring with a check, set a few degrees off-square
// like a hand-pressed stamp. Same drawing as public/favicon.svg.
export const stampMark = (size = 18) => `
  <svg class="stamp-mark" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <g transform="rotate(-12 12 12)">
      <circle cx="12" cy="12" r="9.2" stroke-width="2"/>
      <circle cx="12" cy="12" r="6.6" stroke-width="1" stroke-dasharray="1.6 1.4" opacity=".7"/>
      <path d="M8.6 12.3l2.3 2.3 4.6-5" stroke-width="2.2"/>
    </g>
  </svg>`
