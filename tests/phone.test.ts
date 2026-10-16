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
  on('http.fetch', (_$, e) => {
    fetched.push(e.url)

    return { value: { status: 200, ok: true, headers: {}, text: '{"frames":1}' } }
  })

  const runPhone = (args: string) => $.command.run({ command: 'phone', args } as never)
  const frameOf = (text: string | undefined) => new URL(String(text?.match(/http:\/\/127\.0\.0\.1:\S+/)?.[0]))

  const first = frameOf((await runPhone('3000 pixel8')).text)
  expect(first.origin).toBe('http://127.0.0.1:7358')
  expect(first.searchParams.get('url')).toBe('http://localhost:3000')
  expect(first.searchParams.get('device')).toBe('pixel8')

  // With no argument it reuses the last app and device.
  const again = frameOf((await runPhone('')).text)
  expect(again.searchParams.get('url')).toBe('http://localhost:3000')
  expect(again.searchParams.get('device')).toBe('pixel8')

  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(1000)
  expect(fetched).toContain('http://127.0.0.1:7358/__phone/reload')
  stopHelper()
})
