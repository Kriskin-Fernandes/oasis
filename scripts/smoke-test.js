// Smoke tests.
//   node scripts/smoke-test.js p2p            → self-contained Holesail loopback test (no model needed)
//   node scripts/smoke-test.js forum          → two forum nodes sync a post over Hyperswarm (no model needed)
//   node scripts/smoke-test.js kb [query]     → show which resources the guide would retrieve
//   node scripts/smoke-test.js chat [baseUrl]  → stream one prompt from a running host/client
//                                               (default http://127.0.0.1:8787; use :8788 to test via tunnel)
import http from 'node:http'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { startHostTunnel, startClientTunnel } from '../src/p2p/tunnel.js'
import { ForumNode } from '../src/forum/forum-node.js'
import { KnowledgeBase } from '../src/knowledge/knowledge-base.js'
import { config } from '../src/config.js'

const mode = process.argv[2] || 'p2p'

if (mode === 'p2p') {
  const PORT_A = 18901; const PORT_B = 18902
  const secret = crypto.randomUUID()
  const srv = http.createServer((req, res) => res.end(secret)).listen(PORT_A, '127.0.0.1')
  console.log('▸ starting Holesail host on DHT…')
  const host = await startHostTunnel({ port: PORT_A, key: crypto.randomBytes(32).toString('hex') })
  console.log('▸ host url', host.url)
  console.log('▸ dialling it as a client…')
  const t0 = Date.now()
  const client = await startClientTunnel({ url: host.url, port: PORT_B })
  let body = ''
  for (let i = 0; i < 30; i++) {
    try { body = await (await fetch(`http://127.0.0.1:${PORT_B}/`, { signal: AbortSignal.timeout(5000) })).text(); break } catch { await new Promise((r) => setTimeout(r, 1000)) }
  }
  const ok = body === secret
  console.log(ok ? `✔ P2P tunnel OK — payload round-tripped through HyperDHT in ${Date.now() - t0} ms (peers seen by host: ${host.peers()})` : '✖ P2P tunnel FAILED')
  await client.close(); await host.close(); srv.close()
  process.exit(ok ? 0 : 1)
}

if (mode === 'forum') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guh-forum-'))
  const secret = crypto.randomBytes(32).toString('hex')
  const a = await new ForumNode({ secret, storageFile: path.join(dir, 'a.jsonl') }).start()
  const b = await new ForumNode({ secret, storageFile: path.join(dir, 'b.jsonl') }).start()
  console.log('▸ two forum nodes joined the same Hyperswarm topic, waiting for them to find each other…')
  const t0 = Date.now()
  const post = a.publish({ type: 'post', title: 'Smoke test', body: 'Hello from node A', tag: 'other', alias: 'Test Fern' })
  let ok = false
  for (let i = 0; i < 60 && !ok; i++) { await new Promise((r) => setTimeout(r, 1000)); ok = !!b.thread(post.id) }
  if (ok) {
    b.publish({ type: 'reply', parent: post.id, body: 'Reply from node B', alias: 'Test Moss' })
    for (let i = 0; i < 20 && a.thread(post.id).replies.length === 0; i++) await new Promise((r) => setTimeout(r, 500))
  }
  const both = ok && a.thread(post.id).replies.length === 1
  console.log(both ? `✔ forum sync OK: post A→B and reply B→A over Hyperswarm in ${Date.now() - t0} ms` : '✖ forum sync FAILED')
  await a.close(); await b.close(); fs.rmSync(dir, { recursive: true, force: true })
  process.exit(both ? 0 : 1)
}

if (mode === 'kb') {
  const kb = new KnowledgeBase(config.knowledge)
  const s = kb.load()
  console.log(`▸ ${s.docs} docs / ${s.chunks} chunks from ${s.files.map((f) => f.name).join(', ') || 'nothing'}${s.usingSample ? ' (sample data)' : ''}`)
  if (s.errors.length) console.log('▸ errors:', s.errors)
  const queries = process.argv[3] ? [process.argv.slice(3).join(' ')] : ['I am overwhelmed with deadlines', 'someone keeps bullying me in my flat', 'I feel like I do not belong on my course', 'who can I talk to at night']
  for (const q of queries) {
    const { sources } = kb.retrieve(q)
    console.log(`\n  "${q}"\n   → ${sources.map((d) => d.title).join('\n   → ') || '(nothing)'}`)
  }
  process.exit(0)
}

if (mode === 'chat') {
  const base = process.argv[3] || 'http://127.0.0.1:8787'
  const h = await (await fetch(`${base}/api/health`)).json()
  console.log(`▸ reached host "${h.host}" via ${h.via}`)
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'local', messages: [{ role: 'user', content: 'In one sentence: why does running AI locally help privacy?' }] })
  })
  const j = await res.json()
  if (!res.ok) { console.error('✖', j); process.exit(1) }
  console.log('✔ model answered:', j.choices[0].message.content.trim())
  process.exit(0)
}
