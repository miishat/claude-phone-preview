import type { EngineInterface, Register, Timer } from 'claude-code'

const AFTER_EDIT_MS = 800
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const DEFAULT_URL = 'http://localhost:5173'
// The devices the frame knows; a word among them is a device, not an address.
const DEVICES = new Set([
  'iphonese', 'iphone15', 'iphone16', 'iphone16plus', 'iphone16pro', 'iphone16promax',
  'iphone17', 'iphoneair', 'air', 'iphone17air', 'iphone17pro', 'iphone17promax', 'iphone18pro', 'iphone18promax',
  'ipadmini', 'ipad', 'ipadair', 'ipadair11', 'ipadair13', 'ipadpro11', 'ipadpro13',
  'pixel8', 'galaxys24', 'galaxys', 'galaxyzfold', 'fold', 'pixeltablet', 'tablet',
])
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

// Asks the helper for the dev server of the project Claude works in. A bare
// port narrows it to that port and still picks up the base path.
// Undefined when the helper couldn't be asked; url null when it found nothing.
async function findApp($: $, at: string, port?: string): Promise<{ url: string | null; why: string } | undefined> {
  try {
    const query = new URLSearchParams({ dir: await $.session.cwd(), ...(port ? { port } : {}) })
    const res = await $.http.fetch(`http://127.0.0.1:${at}/__phone/detect?${query}`)
    const found = JSON.parse(res.text) as { url?: string | null; why?: string }
    const url = found.url && (!port || found.url.startsWith(`http://localhost:${port}/`)) ? found.url : null

    return { url, why: found.why ?? '' }
  } catch {
    return undefined
  }
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
      description: 'Start the phone frame for your app and print its link: /phone [url or port] [device]. With no address it finds your dev server.',
    })

    return started
  })

  // Starts the frame server and prints the link. Claude opens it in the
  // Browser pane when asked; a mod's own Browser pane call gets no verdict
  // from auto mode, so the mod does not open it itself.
  on('command.run', { command: 'phone' }, async ($, e) => {
    try {
      const words = (e.args ?? '').trim().split(/\s+/).filter(Boolean)
      const deviceWord = words.find(word => DEVICES.has(word.toLowerCase()))
      const address = words.find(word => word !== deviceWord)
      const device = deviceWord?.toLowerCase() || ((await $.store.get('device')) as string | undefined) || 'iphone15'
      const at = port ?? (await startHelper($))

      // No address, or only a port: find the dev server and its base path.
      let url: string
      let how = ''
      const found = !address || /^\d+$/.test(address) ? await findApp($, at, address) : undefined
      if (found?.url) {
        url = found.url
        how = ` (found it: ${found.why})`
      } else if (found && !address) {
        // Better no phone than another project's app.
        return { text: `No dev server found for this project. ${found.why}
Start it (for example npm run dev), then run /phone again, or give its address: /phone <url or port>.` }
      } else if (address) {
        url = normalizeUrl(address)
      } else {
        url = ((await $.store.get('url')) as string | undefined) ?? DEFAULT_URL
        how = ' (no dev server answered, so this is the last address used)'
      }
      await $.store.set('url', url)
      await $.store.set('device', device)
      const frame = `http://127.0.0.1:${at}/__phone/?${new URLSearchParams({ url, device })}`

      return { text: `Phone frame ready for ${url}${how}: ${frame}\nAsk Claude to open it in the Browser pane.` }
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
