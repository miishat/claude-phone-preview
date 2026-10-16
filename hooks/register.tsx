import type { EngineInterface, Register, Timer } from 'claude-code'

const AFTER_EDIT_MS = 800
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const DEFAULT_URL = 'http://localhost:5173'
// Where helper/server.mjs listens first; a server Claude started by hand for
// the Browser pane is usually here.
const FIRST_PORT = '7357'

// The helper process lives with this load of the module.
let port: string | undefined
let starting: Promise<string> | undefined
let afterEdit: Timer | undefined

type $ = EngineInterface

function startHelper($: $): Promise<string> {
  starting ??= new Promise<string>((resolve, reject) => {
    void (async () => {
      let isReady = false
      try {
        const child = $.process.spawn({ argv: ['node', `${$.plugin.root}/helper/server.mjs`] })
        let buffered = ''
        for await (const { stream, text } of child) {
          if (stream !== 'stdout' || isReady) continue
          buffered += text
          const ready = buffered.match(/READY (\d+)/)
          const failed = buffered.match(/FAILED (.*)/)
          if (ready) {
            isReady = true
            port = ready[1] ?? ''
            resolve(port)
          } else if (failed) {
            reject(new Error(failed[1] ?? 'The phone preview server could not start.'))
          }
        }
        if (!isReady) reject(new Error('The phone preview server could not start. Is Node on your PATH?'))
      } catch (err) {
        if (!isReady) reject(err)
      } finally {
        port = undefined
        starting = undefined
      }
    })()
  })

  return starting
}

function normalizeUrl(raw: string) {
  const url = raw.trim()
  if (/^[a-z]+:\/\//i.test(url)) return url
  if (/^\d+$/.test(url)) return `http://localhost:${url}`
  if (/^(localhost|127\.|\[::1\])/.test(url)) return `http://${url}`

  return `https://${url}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'phone',
      description: 'Start the phone frame for your app and print its link: /phone [url or port] [iphone15|iphonese|pixel8|galaxys]',
    })

    return started
  })

  // Starts the frame server and prints the link. Claude opens it in the
  // Browser pane when asked; a mod's own Browser pane call gets no verdict
  // from auto mode, so the mod does not open it itself.
  on('command.run', { command: 'phone' }, async ($, e) => {
    try {
      const [first, second] = (e.args ?? '').trim().split(/\s+/)
      const stored = (await $.store.get('url')) as string | undefined
      const url = first ? normalizeUrl(first) : (stored ?? DEFAULT_URL)
      const device = second || ((await $.store.get('device')) as string | undefined) || 'iphone15'
      await $.store.set('url', url)
      await $.store.set('device', device)

      const at = port ?? (await startHelper($))
      const frame = `http://127.0.0.1:${at}/__phone/?${new URLSearchParams({ url, device })}`

      return { text: `Phone frame ready for ${url}: ${frame}\nAsk Claude to open it in the Browser pane.` }
    } catch (err) {
      return { text: `Phone preview failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  on('session.end', async ($, e, next) => {
    afterEdit?.cancel()

    return next(e)
  })

  // After Claude edits a file, tell open phone frames to reload, so apps
  // without hot reload show the change too. Each frame can turn this off.
  on('tool.call', async ($, e, next) => {
    const result = next(e)
    if (!EDIT_TOOLS.has(e.tool)) return result
    const at = port ?? FIRST_PORT
    void result
      .then(() => {
        afterEdit?.cancel()
        afterEdit = $.clock.after(AFTER_EDIT_MS, () => {
          void $.http.fetch(`http://127.0.0.1:${at}/__phone/reload`, { method: 'POST' }).catch(() => undefined)
        })
      })
      .catch(() => undefined)

    return result
  })
}
