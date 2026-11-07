#!/usr/bin/env node
// CLIENT: any device without a GPU (a student's laptop).
//  • dials the host's hs:// key over Holesail → the host's AI guide + resources
//  • runs its OWN forum node (Hyperswarm), so the community board keeps
//    working peer-to-peer even if the host is offline
//  • serves the same UI on http://127.0.0.1:8788
//
//   npm run client -- hs://s000…        (or set GUH_HOST_URL)
import os from 'node:os'
import { exec } from 'node:child_process'
import { config } from './config.js'
import { startClientTunnel, lookupHost, secretFromUrl } from './p2p/tunnel.js'
import { ForumNode } from './forum/forum-node.js'
import { createHttpServer, json, listenOrExplain } from './server/http.js'
import { APP_VERSION, API_LEVEL } from './version.js'
import { forumRoutes } from './server/forum-routes.js'
import { loadCrisisContacts } from './guide/safety.js'

const url = process.argv.slice(2).find((a) => a.startsWith('hs://')) || process.env.GUH_HOST_URL
const noOpen = process.argv.includes('--no-open')
if (!url) {
  console.error('Usage: npm run client -- hs://s000<key> [--no-open]')
  process.exit(1)
}

const ts = () => new Date().toLocaleTimeString()
const log = (...a) => console.log(`[${ts()}]`, ...a)
const { client: cc } = config
const hostApi = `http://${cc.host}:${cc.tunnelPort}`
const VIA = { 'x-guh-via': 'p2p-tunnel' }

const crisis = loadCrisisContacts(config.knowledge.crisisFile)

// ── Forum node (independent of the host) ────────────────────────────────────
const forum = new ForumNode({ secret: secretFromUrl(url), storageFile: cc.forumFile, log })
await forum.start()
log('forum: joined community swarm')

// ── Tunnel to the host's GPU ────────────────────────────────────────────────
log('looking up host on the DHT…')
const found = await lookupHost(url)
log(found?.error || (!found?.port && !found?.host) ? 'host not announced yet (or offline), connecting anyway' : 'host found on DHT')
const tunnel = await startClientTunnel({ url, port: cc.tunnelPort, host: cc.host })
log(`tunnel open: ${hostApi}  ⇄  host (peer-to-peer, end-to-end encrypted)`)

// ── Local UI server ─────────────────────────────────────────────────────────
const server = createHttpServer({
  publicDir: config.publicDir,
  routes: [
    ...forumRoutes(forum),
    { method: 'GET', path: '/api/health', handler: (req, res) => json(res, 200, { ok: true, app: config.app.name, role: 'client', version: APP_VERSION, api: API_LEVEL, host: os.hostname(), via: 'local' }) },
    // Urgent-help contacts must work even when the host is offline.
    { method: 'GET', path: '/api/crisis', handler: (req, res) => json(res, 200, crisis) },
    {
      // Merge the host's status (fetched over P2P) with this node's own.
      method: 'GET',
      path: '/api/status',
      handler: async (req, res) => {
        const t0 = Date.now()
        let host = null; let error = null
        try { host = await (await fetch(`${hostApi}/api/status`, { headers: VIA, signal: AbortSignal.timeout(8000) })).json() } catch (e) { error = e.message }
        json(res, 200, {
          ...(host || { app: config.app, model: { state: 'unreachable', model: '—' } }),
          version: APP_VERSION,
          api: API_LEVEL,
          hostApi: host ? host.api || 1 : null,
          node: { role: 'client', name: os.hostname(), hostReachable: !!host, hostRttMs: host ? Date.now() - t0 : null, error },
          clientTunnel: { url, localPort: cc.tunnelPort, state: host ? 'connected' : 'waiting for host' },
          forum: forum.status(),
          you: { via: 'p2p-tunnel' }
        })
      }
    }
  ],
  // Everything else under /api and /v1 goes to the host through Holesail.
  proxy: { host: cc.host, port: cc.tunnelPort, headers: VIA, match: (p) => p.startsWith('/api/') || p.startsWith('/v1/') }
})
await listenOrExplain(server, { port: cc.port, host: cc.host, role: 'client' })
const localUrl = `http://${cc.host}:${cc.port}`

// Prove the P2P path works end to end before telling the user to open it.
const t0 = Date.now()
let ok = false
for (let i = 0; i < 20 && !ok; i++) {
  try {
    const h = await (await fetch(`${hostApi}/api/health`, { headers: VIA, signal: AbortSignal.timeout(5000) })).json()
    log(`connected to host "${h.host}" via ${h.via} in ${Date.now() - t0} ms`)
    ok = true
  } catch { await new Promise((r) => setTimeout(r, 1000)) }
}
if (!ok) log('host not reachable yet. The forum still works P2P; the guide will connect when the host is online.')

console.log(`\n  Open ${localUrl} in your browser.\n  OpenAI-compatible tools: ${localUrl}/v1\n`)
if (!noOpen) openBrowser(localUrl)

function openBrowser (u) {
  const cmd = process.platform === 'win32' ? `start "" "${u}"` : process.platform === 'darwin' ? `open "${u}"` : `xdg-open "${u}"`
  exec(cmd, () => {})
}

async function shutdown () {
  log('closing…')
  server.close()
  await Promise.allSettled([tunnel.close(), forum.close()])
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
