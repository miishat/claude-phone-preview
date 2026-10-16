// Injected by the phone preview proxy at the top of every page of the app,
// before its own scripts. Reports the chosen phone to the app (user agent,
// platform, pixel ratio, screen, standalone mode, safe areas) and tells the
// frame what the page asks of the phone (viewport-fit, theme colour).
;(() => {
  const config = window.__PHONE_PREVIEW__ || {}
  if (!config.ua || window.__phonePreviewShim) return
  window.__phonePreviewShim = true
  const isIos = config.os === 'ios'

  const define = (object, key, get) => {
    try { Object.defineProperty(object, key, { get, configurable: true }) } catch {}
  }
  const screenSize = () => (config.landscape ? [config.screen[1], config.screen[0]] : config.screen)

  // Browser identity.
  const nav = Navigator.prototype
  define(nav, 'userAgent', () => config.ua)
  define(nav, 'appVersion', () => config.ua.replace(/^Mozilla\//, ''))
  define(nav, 'platform', () => config.platform)
  define(nav, 'vendor', () => (isIos ? 'Apple Computer, Inc.' : 'Google Inc.'))
  define(nav, 'maxTouchPoints', () => 5)
  if (isIos) {
    define(nav, 'userAgentData', () => undefined)
    define(nav, 'standalone', () => Boolean(config.standalone))
  } else if (navigator.userAgentData) {
    const brands = navigator.userAgentData.brands
    const data = {
      brands, mobile: true, platform: 'Android',
      getHighEntropyValues: async () => ({ brands, mobile: true, platform: 'Android', model: config.model || '', platformVersion: '14.0.0' }),
      toJSON: () => ({ brands, mobile: true, platform: 'Android' }),
    }
    define(nav, 'userAgentData', () => data)
  }

  // Screen and pixel ratio.
  define(window, 'devicePixelRatio', () => config.dpr)
  const scr = Screen.prototype
  define(scr, 'width', () => screenSize()[0])
  define(scr, 'height', () => screenSize()[1])
  define(scr, 'availWidth', () => screenSize()[0])
  define(scr, 'availHeight', () => screenSize()[1])
  if (window.ScreenOrientation) {
    define(ScreenOrientation.prototype, 'type', () => (config.landscape ? 'landscape-primary' : 'portrait-primary'))
    define(ScreenOrientation.prototype, 'angle', () => (config.landscape ? 90 : 0))
  }
  define(window, 'orientation', () => (config.landscape ? 90 : 0))

  // Media queries a phone answers differently from this desktop browser.
  const realMatchMedia = window.matchMedia.bind(window)
  const forced = [
    [/\(\s*display-mode\s*:\s*standalone\s*\)/, () => Boolean(config.standalone)],
    [/\(\s*display-mode\s*:\s*browser\s*\)/, () => !config.standalone],
  ]
  window.matchMedia = query => {
    const result = realMatchMedia(query)
    const hit = forced.find(([pattern]) => pattern.test(query))
    // Only a plain query is answered here; a compound one keeps the real answer.
    if (!hit || query.replace(hit[0], '').replace(/^\s*(only\s+)?(screen|all)\s+and\s*/i, '').trim() !== '') return result
    return new Proxy(result, { get: (t, k) => (k === 'matches' ? hit[1]() : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) })
  }

  // Safe areas: the proxy turned env(safe-area-inset-*) into these variables.
  const style = document.createElement('style')
  style.id = '__phone-preview'
  const paint = () => {
    const s = config.safe || { top: 0, right: 0, bottom: 0, left: 0 }
    style.textContent = `:root{--pp-safe-top:${s.top}px;--pp-safe-right:${s.right}px;--pp-safe-bottom:${s.bottom}px;--pp-safe-left:${s.left}px}`
      // Phones draw thin overlay scrollbars that take no room.
      + `::-webkit-scrollbar{width:0;height:0;background:transparent}html{scrollbar-width:none}`
  }
  paint()
  ;(document.head || document.documentElement).appendChild(style)

  window.addEventListener('message', e => {
    if (e.source !== parent || !e.data || e.data.phonePreview !== 'config') return
    const wasLandscape = config.landscape
    Object.assign(config, e.data.patch)
    paint()
    if (wasLandscape !== config.landscape) {
      try { screen.orientation?.dispatchEvent(new Event('change')) } catch {}
      window.dispatchEvent(new Event('orientationchange'))
    }
  })

  // Tell the frame what the page asks of the phone.
  const report = () => {
    const viewport = document.querySelector('meta[name="viewport"]')?.content || ''
    const theme = [...document.querySelectorAll('meta[name="theme-color"]')]
      .find(m => !m.media || realMatchMedia(m.media).matches)?.content || null
    const barStyle = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content || null
    let background = null
    try {
      const body = document.body && getComputedStyle(document.body).backgroundColor
      const root = getComputedStyle(document.documentElement).backgroundColor
      background = body && !/rgba\([^)]*,\s*0\)|transparent/.test(body) ? body : root
    } catch {}
    parent.postMessage({
      phonePreview: 'page',
      isCover: /viewport-fit\s*=\s*cover/i.test(viewport),
      theme, barStyle, background,
      path: location.pathname + location.search + location.hash,
    }, '*')
  }
  let pending = 0
  const reportSoon = () => {
    if (pending) return
    pending = setTimeout(() => { pending = 0; report() }, 150)
  }
  document.addEventListener('DOMContentLoaded', report)
  window.addEventListener('load', report)
  new MutationObserver(reportSoon).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['content', 'class', 'style', 'data-theme'] })
  window.addEventListener('popstate', reportSoon)
  for (const method of ['pushState', 'replaceState']) {
    const real = history[method]
    history[method] = function (...args) { const out = real.apply(this, args); reportSoon(); return out }
  }

  // iOS zooms into a text field whose text is under 16px when it gets focus.
  if (isIos) {
    document.addEventListener('focusin', e => {
      const el = e.target
      if (!(el instanceof HTMLElement) || !el.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=color]),textarea,select,[contenteditable=""],[contenteditable=true]')) return
      const size = parseFloat(getComputedStyle(el).fontSize)
      if (size < 16) parent.postMessage({ phonePreview: 'zoom', size }, '*')
    }, true)
  }
})()
