#!/usr/bin/env node
// HOST: the machine with the GPU.
//  • runs Qwen3.5 (4B default) locally via QVAC (the wellbeing guide)
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
import { startHostTunnel, loadOrCreateHostKey, lookupHost } from './p2p/tunnel.js'

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
    printInvite(tunnel.url)
    // Self-check: can a fresh peer find this host on the DHT right now?
    verifyOnDht(tunnel.url)
  } catch (e) {
    p2pState = { enabled: true, state: 'error', error: e.message }
    log('P2P tunnel failed to start:', e.message)
  }
}

log(`open ${localUrl}`)
engine.load().catch(() => {}) // status is reported via events + /api/status

function printInvite (url) {
  const line = '─'.repeat(76)
  console.log(`\n${line}
 P2P READY. This is your community invite. Share it ONLY with people you trust:

   ${url}

 Other devices DON'T need this project. Pick one:

   • Laptop / PC (needs Node.js from nodejs.org):
       npx holesail@2 ${url} --port 8989
     then open  http://127.0.0.1:8989

   • iPhone: install "Holesail Go", scan the QR code below (or paste the invite),
     connect, then open the local address the app shows in Safari.

   • Full Oasis client (its own forum copy, works offline):
       npm run client -- ${url}
${line}`)
  qrcode.generate(url, { small: true })
  console.log(line + '\n')
}

async function verifyOnDht (url, attempt = 1) {
  const r = await lookupHost(url)
  if (r && !r.error && (r.port || r.host)) {
    p2pState = { ...p2pState, dht: 'verified' }
    log('P2P self-check ✔ this host can be found on the Holesail DHT')
  } else if (attempt < 4) {
    setTimeout(() => verifyOnDht(url, attempt + 1), 5000 * attempt)
  } else {
    p2pState = { ...p2pState, dht: 'not found' }
    log('P2P self-check ✖ host not visible on the DHT yet. Check the internet connection, and that Windows Firewall allows Node.js (see README → Troubleshooting).')
  }
}

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
