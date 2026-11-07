#!/usr/bin/env node
// HOST: the machine with the GPU.
//  • runs Qwen3.5-9B locally via QVAC (the wellbeing guide)
//  • indexes ./firecrawl resources for signposting
//  • joins the anonymous P2P forum (Hyperswarm)
//  • serves UI + API on 127.0.0.1 and publishes it via Holesail under a secret key
import qrcode from 'qrcode-terminal'
import { config } from './config.js'
import { QvacEngine } from './inference/qvac-engine.js'
import { KnowledgeBase } from './knowledge/knowledge-base.js'
import { Guide } from './guide/guide.js'
import { loadCrisisContacts } from './guide/safety.js'
import { ForumNode } from './forum/forum-node.js'
import { createHttpServer, listenOrExplain } from './server/http.js'
import { guideRoutes } from './server/guide-routes.js'
import { forumRoutes } from './server/forum-routes.js'
import { startHostTunnel, loadOrCreateHostKey } from './p2p/tunnel.js'

const ts = () => new Date().toLocaleTimeString()
const log = (...a) => console.log(`[${ts()}]`, ...a)

// ── Knowledge + safety ──────────────────────────────────────────────────────
const kb = new KnowledgeBase(config.knowledge)
kb.on('loaded', (s) => log(`resources: ${s.docs} docs / ${s.chunks} chunks from ${s.files.length} file(s)${s.usingSample ? ' (SAMPLE data: ./firecrawl is empty)' : ''}${s.errors.length ? ` · ${s.errors.length} file error(s): ${s.errors.map((e) => e.file).join(', ')}` : ''}`))
kb.load()
kb.watch()
const crisis = loadCrisisContacts(config.knowledge.crisisFile)

// ── Model ───────────────────────────────────────────────────────────────────
const engine = new QvacEngine(config.model)
let midLine = false
engine.on('status', (s) => {
  if (s.state === 'downloading') { midLine = true; return process.stdout.write(`\r[${ts()}] downloading model ${s.progress.toFixed(1)}%   `) }
  if (midLine) { process.stdout.write('\n'); midLine = false }
  log(`model: ${s.state}${s.error ? ' — ' + s.error : ''}${s.loadMs ? ` (${(s.loadMs / 1000).toFixed(1)} s)` : ''}`)
})
const guide = new Guide({ engine, kb, crisis, appName: config.app.name, university: config.app.university })

// ── P2P: community secret drives both the Holesail tunnel and the forum topic ─
const secret = loadOrCreateHostKey(config.host.keyFile)
const forum = new ForumNode({ secret, storageFile: config.host.forumFile, log })
await forum.start()

let tunnel = null
let p2pState = { enabled: config.host.p2p, state: config.host.p2p ? 'starting' : 'disabled' }

const server = createHttpServer({
  publicDir: config.publicDir,
  routes: [
    ...guideRoutes({
      engine, guide, kb, crisis, app: config.app, port: config.host.httpPort, log,
      getP2P: () => ({ ...p2pState, ...(tunnel ? { url: tunnel.url, peers: tunnel.peers(), peerIds: tunnel.peerIds() } : {}) }),
      getForum: () => forum.status()
    }),
    ...forumRoutes(forum)
  ]
})

await listenOrExplain(server, { port: config.host.httpPort, host: config.host.httpHost, role: 'host' })
const localUrl = `http://${config.host.httpHost}:${config.host.httpPort}`
log(`UI + API listening on ${localUrl} (loopback only)`)

if (config.host.p2p) {
  try {
    tunnel = await startHostTunnel({ port: config.host.httpPort, host: config.host.httpHost, key: secret })
    p2pState = { enabled: true, state: 'listening' }
    console.log('\n' + '─'.repeat(72))
    console.log(' P2P ready. This connection string is your community invite.')
    console.log(' Share it ONLY with people you trust:\n')
    console.log('   ' + tunnel.url + '\n')
    console.log(' Another computer:   npm run client -- ' + tunnel.url)
    console.log(' A phone:            scan with the Holesail mobile app\n')
    qrcode.generate(tunnel.url, { small: true })
    console.log('─'.repeat(72) + '\n')
  } catch (e) {
    p2pState = { enabled: true, state: 'error', error: e.message }
    log('P2P tunnel failed to start:', e.message)
  }
}

log(`open ${localUrl}`)
engine.load().catch(() => {}) // status is reported via events + /api/status

let closing = false
async function shutdown () {
  if (closing) return
  closing = true
  log('shutting down…')
  server.close()
  kb.close()
  await Promise.allSettled([tunnel?.close(), forum.close(), engine.close()])
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
