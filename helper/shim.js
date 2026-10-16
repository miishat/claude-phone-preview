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
    const vh = config.vh || { small: innerHeight, large: innerHeight }
    style.textContent = `:root{--pp-safe-top:${s.top}px;--pp-safe-right:${s.right}px;--pp-safe-bottom:${s.bottom}px;--pp-safe-left:${s.left}px;`
      + `--pp-svh:${vh.small / 100}px;--pp-lvh:${vh.large / 100}px}`
      // Phones draw thin overlay scrollbars that take no room.
      + `::-webkit-scrollbar{width:0;height:0;background:transparent}html{scrollbar-width:none}`
  }
  paint()
  ;(document.head || document.documentElement).appendChild(style)

  window.addEventListener('message', e => {
    if (e.source !== parent || !e.data || e.data.phonePreview !== 'config') return
    const wasLandscape = config.landscape
    const keyboardBefore = JSON.stringify(config.keyboard ?? null)
    Object.assign(config, e.data.patch)
    paint()
    if (wasLandscape !== config.landscape) {
      try { screen.orientation?.dispatchEvent(new Event('change')) } catch {}
      window.dispatchEvent(new Event('orientationchange'))
    }
    if (JSON.stringify(config.keyboard ?? null) !== keyboardBefore) onKeyboard()
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
      widget: viewport.match(/interactive-widget\s*=\s*([\w-]+)/i)?.[1]?.toLowerCase() || null,
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

  // When the user last touched, clicked or typed. Phones open the keyboard
  // and tuck their bars away only in answer to the user, not to scripts.
  let lastInput = 0
  const touched = () => { lastInput = Date.now() }
  for (const type of ['pointerdown', 'touchstart', 'touchmove', 'wheel', 'keydown']) {
    window.addEventListener(type, touched, { capture: true, passive: true })
  }
  const isRecent = ms => Date.now() - lastInput < ms

  // The keyboard. The frame draws it; the shim says when a text field gets
  // focus, types the keys the frame sends, and moves the page as the phone
  // would. iOS (and Chrome by default) leave the page its size and shrink
  // the visual viewport; what the keyboard covers stays covered.
  const NO_KEYBOARD = /^(checkbox|radio|button|submit|reset|image|file|range|color|date|time|datetime-local|month|week|hidden)$/
  const isEditable = el => el instanceof HTMLElement && !el.disabled && !el.readOnly && (
    el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !NO_KEYBOARD.test(el.type)) || el.isContentEditable)
  const kindOf = el => {
    const mode = (el.getAttribute('inputmode') || '').toLowerCase()
    if (mode) return mode
    return ['number', 'tel', 'email', 'url', 'search'].includes(el.type) ? el.type : 'text'
  }
  const covered = () => (config.keyboard && config.keyboard.mode === 'visual' ? config.keyboard.overlap : 0)

  let pan = 0
  const vv = window.visualViewport
  if (vv) {
    const proto = Object.getPrototypeOf(vv)
    const real = key => Object.getOwnPropertyDescriptor(proto, key).get.call(vv)
    define(vv, 'height', () => Math.max(0, real('height') - covered()))
    define(vv, 'offsetTop', () => real('offsetTop') + pan)
    define(vv, 'pageTop', () => real('pageTop') + pan)
  }
  const fireViewport = type => { try { vv?.dispatchEvent(new Event(type)) } catch {} }
  const setPan = y => {
    y = Math.round(y)
    if (y === pan) return
    pan = y
    parent.postMessage({ phonePreview: 'pan', y }, '*')
    fireViewport('scroll')
  }

  // Scrolls the field above the keyboard: first the boxes it scrolls in, then
  // the page. Where nothing scrolls far enough, iOS slides the whole page up
  // (fixed headers too), which the frame does by moving the app.
  const bringIntoView = el => {
    const margin = 12
    const shortBy = () => el.getBoundingClientRect().bottom - (innerHeight - covered() - margin)
    let need = shortBy()
    // A scroll that doesn't move the field (a fixed bar's field) is undone.
    const attempt = scroller => {
      const before = scroller === window ? scrollY : scroller.scrollTop
      scroller.scrollBy({ top: need, behavior: 'instant' })
      const after = shortBy()
      if (after > need - 1) scroller.scrollTo({ top: before, behavior: 'instant' })
      else need = after
    }
    for (let node = el.parentElement; node && need > 0; node = node.parentElement) {
      if (!/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY) || node.scrollHeight <= node.clientHeight) continue
      attempt(node)
    }
    if (need > 0) attempt(window)
    setPan(Math.max(0, Math.min(covered(), need)))
  }

  const onKeyboard = () => {
    fireViewport('resize')
    if (!config.keyboard) { setPan(0); return }
    const el = document.activeElement
    if (!isEditable(el)) return
    setTimeout(() => {
      if (config.keyboard?.mode === 'content') el.scrollIntoView({ block: 'nearest' })
      else if (config.keyboard?.mode === 'visual') bringIntoView(el)
    }, 40)
  }

  document.addEventListener('focusin', e => {
    const el = e.target
    if (!isEditable(el)) return
    // A field the page focuses by itself gets no keyboard until it is tapped.
    if (!isRecent(1500)) return
    const kind = kindOf(el)
    if (kind === 'none') return
    parent.postMessage({
      phonePreview: 'keyboard', open: true, kind,
      hint: (el.getAttribute('enterkeyhint') || '').toLowerCase(),
      multiline: el instanceof HTMLTextAreaElement || el.isContentEditable,
    }, '*')
    if (config.keyboard) setTimeout(() => config.keyboard?.mode === 'visual' && bringIntoView(el), 40)
  }, true)
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!isEditable(document.activeElement) && config.keyboard) parent.postMessage({ phonePreview: 'keyboard', open: false }, '*')
    }, 60)
  }, true)
  // Tapping a field that already has focus brings a dismissed keyboard back.
  document.addEventListener('click', e => {
    if (!config.keyboard && e.target === document.activeElement && isEditable(e.target)) {
      e.target.blur()
      e.target.focus()
    }
  }, true)

  const insertText = (el, text) => {
    if (document.execCommand('insertText', false, text)) return
    if (el.isContentEditable) return
    try { el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end') } catch { el.value += text }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  }
  const deleteBack = el => {
    if (document.execCommand('delete')) return
    if (el.isContentEditable) return
    try {
      const start = el.selectionStart === el.selectionEnd ? Math.max(0, el.selectionStart - 1) : el.selectionStart
      el.setRangeText('', start, el.selectionEnd, 'end')
    } catch { el.value = el.value.slice(0, -1) }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }))
  }
  const typeKey = (el, key) => {
    const init = { key, code: key === ' ' ? 'Space' : key.length === 1 ? '' : key, bubbles: true, cancelable: true }
    if (el.dispatchEvent(new KeyboardEvent('keydown', init))) {
      if (key === 'Backspace') deleteBack(el)
      else if (key === 'Enter') {
        if (el instanceof HTMLInputElement) el.form?.requestSubmit()
        else if (el.isContentEditable) document.execCommand('insertLineBreak')
        else insertText(el, '\n')
      } else insertText(el, key)
    }
    el.dispatchEvent(new KeyboardEvent('keyup', init))
  }
  const moveFocus = (el, dir) => {
    const fields = [...document.querySelectorAll('input,textarea,[contenteditable]')]
      .filter(f => isEditable(f) && f.getClientRects().length)
    const next = fields[fields.indexOf(el) + (dir === 'next' ? 1 : -1)]
    next?.focus()
  }

  window.addEventListener('message', e => {
    if (e.source !== parent || !e.data) return
    const kind = e.data.phonePreview
    if (kind !== 'key' && kind !== 'blur' && kind !== 'move') return
    touched()
    const el = document.activeElement
    if (!isEditable(el)) return
    if (kind === 'blur') {
      el.blur()
      parent.postMessage({ phonePreview: 'keyboard', open: false }, '*')
    }
    else if (kind === 'move') moveFocus(el, e.data.dir)
    else {
      if (!document.hasFocus()) el.focus()
      typeKey(el, e.data.key)
    }
  })

  // The browser's bars. Scrolling the page down tucks Safari's toolbar and
  // Chrome's address bar away, scrolling up brings them back, and so does the
  // top of the page (and, in Safari, its end). Boxes that scroll inside the
  // page don't move the bars, as on a phone.
  let lastY = scrollY
  let travel = 0
  window.addEventListener('scroll', () => {
    const y = scrollY
    const dy = y - lastY
    lastY = y
    if (!config.collapses || config.keyboard || !isRecent(1500) || !dy) return
    travel = Math.sign(dy) === Math.sign(travel) ? travel + dy : dy
    let min = Boolean(config.barsMin)
    if (y <= 0) min = false
    else if (travel > 12) min = true
    else if (travel < -12) min = false
    if (isIos && y + innerHeight >= document.documentElement.scrollHeight - 2) min = false
    if (min !== Boolean(config.barsMin)) {
      config.barsMin = min
      parent.postMessage({ phonePreview: 'bars', min }, '*')
    }
  }, { passive: true })

  // Viewport units. On a phone 100vh is the viewport with the bars tucked
  // away (100lvh) and 100svh with them shown; 100dvh follows the bars. The
  // frame is always the current viewport, so dvh stays as it is and the
  // others are pointed at the sizes the frame sends. Only the values of the
  // page's style rules change: selectors, class names and scripts are left alone.
  const HAS_VH = /\d(s|l)?vh\b/
  const toVars = value => value.replace(/(-?\d*\.?\d+)(svh|lvh|vh)\b/g, (m, n, unit) => `calc(${n} * var(--pp-${unit === 'svh' ? 'svh' : 'lvh'}))`)
  const fixStyle = decl => {
    for (let i = 0; i < decl.length; i++) {
      const name = decl[i]
      const value = decl.getPropertyValue(name)
      if (HAS_VH.test(value)) decl.setProperty(name, toVars(value), decl.getPropertyPriority(name))
    }
  }
  const fixRules = rules => {
    for (const rule of rules) {
      if (rule.style) fixStyle(rule.style)
      if (rule.cssRules) fixRules(rule.cssRules)
    }
  }
  const fixed = new WeakSet()
  const fixSheets = () => {
    if (!config.collapses) return
    for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets || [])]) {
      if (fixed.has(sheet)) continue
      try { fixRules(sheet.cssRules); fixed.add(sheet) } catch {}
    }
  }
  const fixInline = el => {
    if (el.getAttribute?.('style')?.includes('vh')) fixStyle(el.style)
  }
  new MutationObserver(list => {
    if (!config.collapses) return
    let sheets = false
    for (const m of list) {
      if (m.type === 'attributes') { fixInline(m.target); continue }
      if (m.target.nodeName === 'STYLE') sheets = true
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue
        if (node.nodeName === 'STYLE' || node.nodeName === 'LINK') sheets = true
        fixInline(node)
        for (const child of node.querySelectorAll('[style*="vh"]')) fixInline(child)
      }
    }
    if (sheets) fixSheets()
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] })
  document.addEventListener('load', e => { if (e.target.nodeName === 'LINK') fixSheets() }, true)
  document.addEventListener('DOMContentLoaded', () => {
    fixSheets()
    if (config.collapses) for (const el of document.querySelectorAll('[style*="vh"]')) fixInline(el)
  })
  window.addEventListener('load', fixSheets)
})()
