import { expect, mock, test } from 'claude-code/testing'

test('/phone starts the frame server, prints its link, and edits reload it', async ($, on) => {
  const fetched: string[] = []
  const clock = mock.clock(on)
  mock.store(on)

  let stopHelper = () => {}
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: 'READY 7358\n' }
    // The helper keeps running until the test ends.
    await new Promise<void>(resolve => {
      stopHelper = resolve
    })

    return { value: { code: 0, signal: null } }
  })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('session.cwd', () => ({ value: 'C:/code/ledger' }))
  // The helper finds a dev server only once the test says one is running.
  let running: string | null = null
  on('http.fetch', (_$, e) => {
    fetched.push(e.url)
    const text = e.url.includes('/__phone/detect') ? JSON.stringify({ url: running, why: 'serves ledger' }) : '{"frames":1}'

    return { value: { status: 200, ok: true, headers: {}, text } }
  })

  const runPhone = (args: string) => $.command.run({ command: 'phone', args } as never)
  const frameOf = (text: string | undefined) => new URL(String(text?.match(/http:\/\/127\.0\.0\.1:\S+/)?.[0]))

  const first = frameOf((await runPhone('3000 pixel8')).text)
  expect(first.origin).toBe('http://127.0.0.1:7358')
  expect(first.searchParams.get('url')).toBe('http://localhost:3000')
  expect(first.searchParams.get('device')).toBe('pixel8')

  // With no argument and no dev server for the project, it says so rather than open another app.
  expect((await runPhone('')).text).toContain('No dev server found for this project')

  // A port alone keeps that port when the helper finds nothing on it.
  const again = frameOf((await runPhone('3000')).text)
  expect(again.searchParams.get('url')).toBe('http://localhost:3000')
  expect(again.searchParams.get('device')).toBe('pixel8')

  // With a dev server running, it finds it, base path and all; a device alone is a device.
  running = 'http://localhost:5173/ledger/'
  const found = await runPhone('iphone15')
  expect(found.text).toContain('found it: serves ledger')
  expect(frameOf(found.text).searchParams.get('url')).toBe('http://localhost:5173/ledger/')
  expect(frameOf(found.text).searchParams.get('device')).toBe('iphone15')
  expect(fetched.some(url => url.startsWith('http://127.0.0.1:7358/__phone/detect?dir='))).toBe(true)

  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(1000)
  expect(fetched).toContain('http://127.0.0.1:7358/__phone/reload')
  stopHelper()
})
