import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

export default defineConfig(({ mode }) => ({
  // Relative paths so Electron can load dist/index.html straight off disk.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // npm run demo: real folder scan from src/demo-scan.json instead of Supabase
  resolve: mode === 'demo' ? { alias: [{ find: /^(\.\.?\/)+data\.js$/, replacement: fileURLToPath(new URL('./src/demoData.js', import.meta.url)) }] } : {},
  server: {
    host: true,
    watch: { ignored: ['**/release/**', '**/dist/**'] },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Vetted',
        short_name: 'Vetted',
        description: 'Every APm raw material evaluation in one grid',
        theme_color: '#f2f2f7',
        background_color: '#f2f2f7',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'] },
    }),
  ],
}))
