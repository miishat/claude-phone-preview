// Phone preview helper. Serves the phone frame at /__phone/ and proxies
// every other path to the app being previewed, so the app runs on the same
// origin as the frame: the Browser pane's phone emulation then reaches it,
// and its cookies and storage are first-party. Into each HTML page it injects
// a small shim (shim.js) that reports the chosen device to the app.
// Prints `READY <port>` on stdout once it listens.

import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIRST_PORT = 7357
const LAST_PORT = 7377
const here = path.dirname(fileURLToPath(import.meta.url))
const file = name => readFileSync(path.join(here, name))

// What the frame last asked for: the app's origin and the device to report.
let target = { origin: 'http://localhost:5173', device: {} }
const listeners = new Set()

// Network conditions the frame picked: latency before each response and the
// download speed (kbps). The app's own code (scripts, styles, workers) loads
// at full speed, so a dev server's hundreds of modules don't crawl; pages,
// data, images and fonts get the phone's network.
const NETWORKS = {
  online: null,
  fast4g: { latency: 40, kbps: 9000 },
  slow4g: { latency: 150, kbps: 1600 },
  '3g': { latency: 400, kbps: 750 },
  offline: { offline: true },
}
let network = 'online'
const isAppCode = req => ['script', 'style', 'worker', 'sharedworker', 'serviceworker'].includes(String(req.headers['sec-fetch-dest']))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Writes in small pieces at the network's download speed.
async function writePaced(res, buf, kbps) {
  for (let i = 0; i < buf.length && !res.destroyed; i += 8192) {
    const piece = buf.subarray(i, i + 8192)
    res.write(piece)
    await sleep((piece.length * 8) / kbps)
  }
}
function pipePaced(src, res, net) {
  if (!net) return src.pipe(res)
  let chain = Promise.resolve()
  src.on('data', chunk => {
    src.pause()
    chain = chain.then(() => writePaced(res, chunk, net.kbps)).then(() => src.resume())
  })
  src.on('end', () => chain.then(() => res.end()))
}
function endPaced(res, body, net) {
  if (!net) return res.end(body)
  writePaced(res, body, net.kbps).then(() => res.end())
}

// What the phone's browser shows for a page it can't reach offline.
function offlinePage(res) {
  const ios = target.device.os === 'ios'
  const [title, text] = ios
    ? ['Safari Cannot Open the Page', 'Safari cannot open the page because your iPhone is not connected to the internet.']
    : ['No internet', 'Try checking the network cables, modem and router, or reconnecting to Wi-Fi.']
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;min-height:100vh;display:flex;flex-direction:column;justify-content:center;padding:32px;box-sizing:border-box;font:16px/1.4 -apple-system,system-ui,sans-serif;color:#555;background:#fff;text-align:${ios ? 'center' : 'left'}"><h1 style="font-size:${ios ? 22 : 24}px;color:#222;margin:0 0 12px">${title}</h1><p style="margin:0">${text}</p></body>`)
}

const TEXT = /^(text\/html|text\/css|(application|text)\/(javascript|ecmascript)|application\/x-javascript)/

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise(resolve => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => resolve(body))
  })
}

// The frame's own routes.
async function phoneRoute(req, res, sub) {
  if (sub === '/' || sub === '') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(file('phone.html'))
  } else if (sub === '/target' && req.method === 'POST') {
    const next = JSON.parse((await readBody(req)) || '{}')
    const origin = new URL(next.url).origin
    target = { origin, device: next.device ?? {} }
    if (next.network in NETWORKS) network = next.network
    json(res, 200, { origin })
  } else if (sub === '/network' && req.method === 'POST') {
    const next = JSON.parse((await readBody(req)) || '{}')
    if (next.network in NETWORKS) network = next.network
    json(res, 200, { network })
  } else if (sub === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write(': connected\n\n')
    listeners.add(res)
    req.on('close', () => listeners.delete(res))
  } else if (sub === '/reload' && req.method === 'POST') {
    for (const listener of listeners) listener.write('data: reload\n\n')
    json(res, 200, { frames: listeners.size })
  } else if (sub === '/health') {
    json(res, 200, { app: 'phone-preview', target: target.origin, network })
  } else {
    res.writeHead(404).end()
  }
}

// Headers for the app's server: it should see its own host, and the chosen
// phone's user agent.
function upstreamHeaders(req) {
  const up = new URL(target.origin)
  const headers = { ...req.headers, host: up.host, 'accept-encoding': 'identity' }
  if (target.device.ua) headers['user-agent'] = target.device.ua
  if (headers.origin) headers.origin = target.origin
  if (headers.referer) headers.referer = headers.referer.replace(/^https?:\/\/[^/]+/, target.origin)
  delete headers['sec-ch-ua']
  delete headers['sec-ch-ua-mobile']
  delete headers['sec-ch-ua-platform']
  return headers
}

function rewriteText(text, isHtml, self) {
  // A page's safe-area insets come from the frame, which knows the phone's
  // notch and home indicator; env() inside an iframe is always 0.
  let out = text.replace(/env\(\s*safe-area-inset-(top|right|bottom|left)/g, 'var(--pp-safe-$1')
  // Absolute links back to the app's own origin stay inside the proxy.
  out = out.split(target.origin).join(self)
  if (isHtml) {
    const shim = `<script>window.__PHONE_PREVIEW__=${JSON.stringify(target.device)};</script><script>${file('shim.js')}</script>`
    out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, m => m + shim) : shim + out
  }
  return out
}

function proxy(req, res) {
  const net = isAppCode(req) ? null : NETWORKS[network]
  if (!net) return forward(req, res, null)
  if (net.offline) {
    const dest = String(req.headers['sec-fetch-dest'])
    // A page load gets the browser's offline page; anything else fails the way a dropped connection does.
    if (dest === 'document' || dest === 'iframe') offlinePage(res)
    else req.socket.destroy()
    return
  }
  setTimeout(() => forward(req, res, net), net.latency)
}

function forward(req, res, net) {
  const up = new URL(req.url, target.origin)
  const lib = up.protocol === 'https:' ? https : http
  const self = `http://${req.headers.host}`
  const upstream = lib.request(up, { method: req.method, headers: upstreamHeaders(req) }, upRes => {
    const headers = { ...upRes.headers }
    delete headers['x-frame-options']
    if (headers['content-security-policy']) {
      headers['content-security-policy'] = String(headers['content-security-policy'])
        .split(';').filter(d => !/^\s*frame-ancestors/i.test(d)).join(';')
    }
    if (headers.location) headers.location = String(headers.location).split(target.origin).join(self)
    if (headers['set-cookie']) {
      headers['set-cookie'] = [].concat(headers['set-cookie']).map(c => c.replace(/;\s*domain=[^;]*/i, ''))
    }
    const type = String(headers['content-type'] ?? '')
    if (!TEXT.test(type) || req.method === 'HEAD') {
      res.writeHead(upRes.statusCode ?? 502, headers)
      pipePaced(upRes, res, net)
      return
    }
    const chunks = []
    upRes.on('data', c => chunks.push(c))
    upRes.on('end', () => {
      const body = Buffer.from(rewriteText(Buffer.concat(chunks).toString('utf8'), type.startsWith('text/html'), self))
      delete headers['content-encoding']
      headers['content-length'] = String(body.length)
      res.writeHead(upRes.statusCode ?? 502, headers)
      endPaced(res, body, net)
    })
  })
  upstream.on('error', err => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font:15px system-ui;padding:24px;color:#555">
        <p><b>Can't reach ${target.origin}</b></p><p>Is your dev server running?</p><p style="color:#999">${err.code ?? err.message}</p>`)
    }
  })
  req.pipe(upstream)
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x')
  if (pathname === '/__phone' || pathname.startsWith('/__phone/')) {
    phoneRoute(req, res, pathname.slice('/__phone'.length)).catch(err => json(res, 500, { error: err.message }))
  } else {
    proxy(req, res)
  }
})

// WebSockets (a dev server's hot reload) pass straight through.
server.on('upgrade', (req, socket, head) => {
  const up = new URL(req.url, target.origin)
  const lib = up.protocol === 'https:' ? https : http
  const upstream = lib.request(up, { method: req.method, headers: upstreamHeaders(req) })
  upstream.on('upgrade', (upRes, upSocket, upHead) => {
    const lines = [`HTTP/1.1 101 ${upRes.statusMessage ?? 'Switching Protocols'}`]
    for (let i = 0; i < upRes.rawHeaders.length; i += 2) lines.push(`${upRes.rawHeaders[i]}: ${upRes.rawHeaders[i + 1]}`)
    socket.write(lines.join('\r\n') + '\r\n\r\n')
    if (upHead?.length) socket.write(upHead)
    if (head?.length) upSocket.write(head)
    upSocket.pipe(socket).pipe(upSocket)
    upSocket.on('error', () => socket.destroy())
    socket.on('error', () => upSocket.destroy())
  })
  upstream.on('response', upRes => {
    socket.end(`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}\r\n\r\n`)
  })
  upstream.on('error', () => socket.destroy())
  upstream.end()
})

// Keeps idle event streams open through proxies and sleep.
setInterval(() => {
  for (const listener of listeners) listener.write(': ping\n\n')
}, 25_000)

// Whether something already answers on the port. Windows can let a second
// server bind a taken port for a moment before it reports the clash.
function isTaken(port) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.setTimeout(500, () => { socket.destroy(); resolve(false) })
  })
}

async function listen() {
  for (let port = FIRST_PORT; port <= LAST_PORT; port++) {
    if (await isTaken(port)) continue
    const ok = await new Promise(resolve => {
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => resolve(true))
    })
    if (ok) {
      process.stdout.write(`READY ${port}\n`)
      return
    }
  }
  process.stdout.write(`FAILED no free port between ${FIRST_PORT} and ${LAST_PORT}\n`)
  process.exit(1)
}

listen()
