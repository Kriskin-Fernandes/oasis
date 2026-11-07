// Tiny HTTP framework shared by host and client nodes.
//
//   createHttpServer({ routes, publicDir, proxy })
//     routes : [{ method, path: '/api/forum/posts/:id', handler(req, res, params, url) }]
//     proxy  : optional { host, port, match(pathname), headers } — anything that
//              matches (and isn't a local route) is streamed to that target.
//              The client node uses this to reach the host through Holesail.
//
// The server always binds to loopback (see host.js / client.js).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.png': 'image/png' }
const MAX_BODY = 1024 * 1024

export function createHttpServer ({ routes, publicDir, proxy = null }) {
  const compiled = routes.map((r) => ({ ...r, ...compile(r.path) }))

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    try {
      for (const r of compiled) {
        if (r.method !== req.method) continue
        const m = r.re.exec(url.pathname)
        if (!m) continue
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
        return await r.handler(req, res, params, url)
      }
      if (proxy && proxy.match(url.pathname)) return forward(req, res, proxy)
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(publicDir, url.pathname, res)
      json(res, 404, { error: 'not found' })
    } catch (e) {
      if (!res.headersSent) json(res, e.status || 500, { error: e.message })
      else res.end()
    }
  })
}

function compile (p) {
  const keys = []
  const re = new RegExp('^' + p.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '$')
  return { re, keys }
}

/** Stream a request to another HTTP server (SSE-safe: no buffering). */
function forward (req, res, { host, port, headers = {} }) {
  const up = http.request({ host, port, method: req.method, path: req.url, headers: { ...req.headers, host: `${host}:${port}`, ...headers } }, (upRes) => {
    res.writeHead(upRes.statusCode, upRes.headers)
    upRes.pipe(res)
  })
  up.setTimeout(15000, () => up.destroy(new Error('timeout')))
  up.on('response', () => up.setTimeout(0)) // streaming replies can be long
  up.on('error', (e) => {
    if (!res.headersSent) json(res, 502, { error: 'host unreachable over P2P', detail: e.message })
    else res.end()
  })
  res.on('close', () => up.destroy())
  req.pipe(up)
}

export function json (res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(obj))
}

export function sse (res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' })
  res.flushHeaders?.()
  return (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
}

export function readJson (req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })) }
    })
    req.on('error', reject)
  })
}

/** Abort signal that fires if the browser goes away mid-stream. */
export function clientGone (res) {
  const ac = new AbortController()
  res.on('close', () => { if (!res.writableFinished) ac.abort() })
  return ac.signal
}

function serveStatic (dir, pathname, res) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  const file = path.resolve(dir, rel)
  if (!file.startsWith(path.resolve(dir) + path.sep)) return json(res, 403, { error: 'forbidden' })
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' })
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' })
    res.end(data)
  })
}

/**
 * listen() with a human explanation when the port is taken — most often by
 * an older Oasis process that is still running in another terminal.
 */
export async function listenOrExplain (server, { port, host, role }) {
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve) })
  } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e
    let who = 'another program'
    try {
      const h = await (await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(2000) })).json()
      who = h.version ? `another Oasis ${h.role || ''} (v${h.version})` : 'an OLDER version of this app'
    } catch {}
    console.error(`\n✖ Port ${port} is already in use by ${who}.\n` +
      `  Stop it first: find its terminal window and press Ctrl+C (or close the window), then run this again.\n` +
      `  Or use a different port: set ${role === 'client' ? 'GUH_CLIENT_PORT' : 'GUH_HTTP_PORT'}=<port>.\n`)
    process.exit(1)
  }
}
