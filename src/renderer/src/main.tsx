import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Apply theme attribute synchronously so the boot placeholder + first paint
// already match the user's preference and we avoid a flash of the wrong
// theme.
;(() => {
  const stored = localStorage.getItem('theme')
  const pref = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
  const resolved =
    pref === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : pref
  document.documentElement.setAttribute('data-theme', resolved)

  // Tag the platform on <html> so CSS can offset for native window controls
  // (macOS traffic lights vs Windows min/max/close).
  const platform = (navigator as any).userAgentData?.platform ?? navigator.platform ?? ''
  const cls =
    /mac|darwin/i.test(platform) ? 'platform-darwin'
    : /win/i.test(platform)      ? 'platform-win32'
    : 'platform-linux'
  document.documentElement.classList.add(cls)
})()

const rootEl = document.getElementById('root')!
const root = createRoot(rootEl)

root.render(<div className="app-boot-placeholder" aria-hidden />)

void import('./App').then(({ default: App }) => {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
