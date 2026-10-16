// Finds the dev server of the app being built, so nobody types its address.
// It reads the project (package.json, the framework's config) for the port
// and base path, checks which of those and the usual dev ports answer with a
// page, and picks the one that belongs to the project.
// Run directly, `node detect.mjs [project folder] [port]` prints the answer as JSON.

import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const COMMON_PORTS = [5173, 5174, 5175, 3000, 3001, 4200, 4321, 8080, 8000, 5000, 4173, 8081, 19006]
// Where each framework's dev server listens unless told otherwise.
const FRAMEWORKS = [
  ['@sveltejs/kit', 'SvelteKit', 5173],
  ['astro', 'Astro', 4321],
  ['nuxt', 'Nuxt', 3000],
  ['next', 'Next.js', 3000],
  ['@angular/core', 'Angular', 4200],
  ['react-scripts', 'Create React App', 3000],
  ['expo', 'Expo', 8081],
  ['vite', 'Vite', 5173],
]

const read = file => { try { return readFileSync(file, 'utf8') } catch { return null } }
const firstFile = (dir, names) => names.map(name => path.join(dir, name)).find(existsSync)
const match = (text, re) => text?.match(re)?.[1]

// What the project says about its dev server.
export function readProject(dir) {
  const project = { dir, name: null, framework: null, port: null, defaultPort: null, base: '/' }
  const pkg = (() => { try { return JSON.parse(read(path.join(dir, 'package.json'))) } catch { return null } })()
  if (!pkg) return project
  project.name = pkg.name ?? null
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const found = FRAMEWORKS.find(([dep]) => deps[dep])
  if (found) [, project.framework, project.defaultPort] = found

  const script = [pkg.scripts?.dev, pkg.scripts?.start, pkg.scripts?.serve].filter(Boolean).join(' ')
  const scriptPort = match(script, /(?:--port[= ]|-p |PORT=)(\d{2,5})/)
  if (scriptPort) project.port = Number(scriptPort)

  // Config files are code, so this reads the plain literal values only.
  const configs = {
    Vite: ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs', 'vite.config.cjs'],
    SvelteKit: ['vite.config.ts', 'vite.config.js'],
    Astro: ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'],
    'Next.js': ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    Nuxt: ['nuxt.config.ts', 'nuxt.config.js'],
  }
  const config = read(firstFile(dir, configs[project.framework] ?? []) ?? '')
  if (config) {
    const base = match(config, /\b(?:base|basePath|baseURL)\s*:\s*['"`](\/[^'"`]*)['"`]/)
    if (base) project.base = base
    const port = match(config, /\bport\s*:\s*(\d{2,5})/)
    if (port && !project.port) project.port = Number(port)
  }
  if (project.framework === 'Angular') {
    const angular = read(path.join(dir, 'angular.json'))
    project.base = match(angular, /"baseHref"\s*:\s*"(\/[^"]*)"/) ?? project.base
    project.port ??= Number(match(angular, /"port"\s*:\s*(\d{2,5})/)) || null
  }
  if (project.framework === 'Create React App' && pkg.homepage) {
    try { project.base = new URL(pkg.homepage, 'http://x').pathname } catch {}
  }
  if (!project.base.endsWith('/')) project.base += '/'
  return project
}

// A GET that never throws: status, type and the start of the body.
function get(host, port, pathname) {
  return new Promise(resolve => {
    const req = http.get({ host, port, path: pathname, timeout: 1500, headers: { accept: 'text/html,*/*' } }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { if (body.length < 20000) body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, type: String(res.headers['content-type'] ?? ''), location: res.headers.location, body }))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
  })
}

// Dev servers listen on 127.0.0.1, on ::1 (Vite under newer Node), or both.
async function probe(port, base) {
  for (const host of ['127.0.0.1', '::1']) {
    let res = await get(host, port, base)
    if (!res) continue
    let found = base
    // A Vite server with a base sends other paths there, or answers with a page naming it.
    const moved = res.status >= 300 && res.status < 400 && res.location && match(res.location, /^(?:https?:\/\/[^/]+)?(\/[^?#]*)/)
    const hinted = res.status === 404 && (match(res.body, /did you mean to visit <a href="(\/[^"]*)"/) ?? match(res.body, /public base URL of (\/\S*?\/)/))
    if (moved || hinted) {
      found = moved || hinted
      res = await get(host, port, found)
      if (!res) continue
    }
    if (!(res.status < 400 && /html/.test(res.type))) return { port, isPage: false }
    return { port, host, base: found, isPage: true }
  }
  return null
}

// Which project a server serves, when it says: a Vite server hands out the
// project's own package.json. Null when it can't tell.
async function projectOf(server) {
  const res = await get(server.host, server.port, `${server.base}package.json`)
  if (res?.status !== 200) return null
  return match(res.body, /"name"\s*:\s*"([^"]+)"/) ?? match(res.body, /\bname\s*=\s*"([^"]+)"/) ?? null
}

export async function detect({ dir, port } = {}) {
  const project = dir ? readProject(dir) : null
  const preferred = [port, project?.port, project?.defaultPort].filter(Boolean).map(Number)
  const ports = [...new Set([...preferred, ...COMMON_PORTS])]
  const found = (await Promise.all(ports.map(p => probe(p, project?.base ?? '/')))).filter(s => s?.isPage)
  for (const server of found) server.serves = await projectOf(server)
  const list = found.map(s => `http://localhost:${s.port}${s.base}${s.serves ? ` (${s.serves})` : ''}`)
  if (!found.length) return { url: null, project, servers: [], why: 'No dev server answered on the usual ports.' }

  // The project's own server first: the one that says it serves the project.
  // A server that says it serves another project is never picked for this one.
  // Then the port asked for, the port the config names, the framework's usual one.
  const known = project?.name
  const own = known ? found.find(s => s.serves === known) : null
  const servers = known ? found.filter(s => !s.serves || s.serves === known) : found
  let pick = own
  let why = own ? `serves ${known}` : ''
  if (!pick && port) { pick = servers.find(s => s.port === Number(port)); why = 'the port asked for' }
  if (!pick && project?.port) { pick = servers.find(s => s.port === project.port); why = `${project.framework ?? 'the project'}'s configured port` }
  if (!pick && project?.defaultPort) { pick = servers.find(s => s.port === project.defaultPort); why = `${project.framework}'s usual port` }
  if (!pick && !known) { pick = servers[0]; why = 'the first dev server found' }
  if (!pick) {
    return { url: null, project, servers: list, why: `No dev server for ${known} is running; the ones answering serve other projects.` }
  }
  return { url: `http://localhost:${pick.port}${pick.base}`, project, servers: list, why }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, port] = process.argv.slice(2)
  detect({ dir: dir ? path.resolve(dir) : process.cwd(), port }).then(result => console.log(JSON.stringify(result, null, 2)))
}
