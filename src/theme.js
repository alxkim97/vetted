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

// The stamp mark: a rubber stamp (handle, neck, inked base, the print under
// it). Same drawing as public/favicon.svg.
export const STAMP_PATH = 'M9 3h6v5l-1.5 3h6A1.5 1.5 0 0 1 21 12.5V16H3v-3.5A1.5 1.5 0 0 1 4.5 11h6L9 8z'
export const stampMark = (size = 18) => `
  <svg class="stamp-mark" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <path d="${STAMP_PATH}" fill="currentColor"/><rect x="4" y="18" width="16" height="2.5" rx="1" fill="currentColor"/>
  </svg>`
