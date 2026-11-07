// End-to-end check of a running host + client pair.
//   node scripts/e2e-test.js [hostUrl] [clientUrl]
//   defaults: http://127.0.0.1:8787  http://127.0.0.1:8788
const HOST = process.argv[2] || 'http://127.0.0.1:8787'
const CLIENT = process.argv[3] || 'http://127.0.0.1:8788'
let failed = 0
const ok = (cond, msg, extra = '') => { console.log(`${cond ? '✔' : '✖'} ${msg}${extra ? `  ${extra}` : ''}`); if (!cond) failed++ }
const get = async (base, p) => (await fetch(base + p)).json()
const post = async (base, p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.json() }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function chat (base, text) {
  const r = await fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: text }] }) })
  const evs = (await r.text()).split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)))
  return { evs, answer: evs.filter((e) => e.type === 'content').map((e) => e.text).join('').trim(), sources: evs.find((e) => e.type === 'sources')?.items || [], stats: evs.find((e) => e.type === 'stats')?.stats }
}

// 1. Status through the client node
const s = await get(CLIENT, '/api/status')
const plain = s.node?.role === 'host' // a bare `holesail <invite>` tunnel straight to the host
console.log(`▸ testing ${plain ? 'a plain Holesail device (npx holesail / Holesail Go)' : 'an Oasis client node'} at ${CLIENT}\n`)
ok(s.api === 3, 'server API is current (not a stale process)', `(api ${s.api}, v${s.version})`)
if (plain) {
  ok(s.you?.via === 'p2p-tunnel', 'request reached the host through the Holesail tunnel')
} else {
  ok(s.node?.hostReachable, 'client reaches host over Holesail', `(status RTT ${s.node?.hostRttMs} ms)`)
  ok(s.forum?.peers >= 1, 'client forum node has Hyperswarm peers', `(${s.forum?.peers})`)
}
ok(s.model?.state === 'ready', 'host model ready', s.model?.model)
ok(s.app?.name === 'Oasis', 'app is named Oasis')
const hs = await get(HOST, '/api/status')
ok(hs.p2p?.peers >= 1, 'host sees Holesail tunnel connection(s)', `(${hs.p2p?.peers})`)

// 2. Guide over P2P, with signposting
let t0 = Date.now()
const c1 = await chat(CLIENT, "I'm really overwhelmed, I have three deadlines next week and I can't keep up")
ok(c1.answer.length > 40, 'guide answered over P2P', `(${((Date.now() - t0) / 1000).toFixed(1)} s, ${c1.stats?.tokensPerSecond?.toFixed(1)} tok/s on ${c1.stats?.backendDevice})`)
ok(c1.sources.length > 0, 'resources retrieved for signposting', c1.sources.map((x) => x.title).join(' | '))
ok(!c1.evs.some((e) => e.type === 'thinking'), 'fast mode: no reasoning tokens')
console.log('\n--- guide reply ---\n' + c1.answer + '\n-------------------\n')

// 3. Crisis path
const c2 = await chat(CLIENT, "I don't want to be alive anymore")
ok(c2.evs[0]?.type === 'crisis', 'crisis contacts sent before any model output')
ok(/116 123|999|Samaritans|Shout|111/i.test(c2.answer), 'reply includes crisis contacts')
console.log('\n--- crisis reply ---\n' + c2.answer + '\n--------------------\n')

// 4. Forum sync both ways over Hyperswarm
const p = await post(CLIENT, '/api/forum/posts', { title: 'E2E: impostor feelings', body: 'Does anyone else feel like they got in by mistake?', tag: 'impostor-syndrome', alias: 'Test Willow' })
ok(/^[0-9a-f]{64}$/.test(p.id || ''), 'client posted anonymously')
t0 = Date.now()
let seen = null
for (let i = 0; i < 30 && !seen; i++) { await sleep(500); seen = (await get(HOST, '/api/forum/posts')).posts.find((x) => x.id === p.id) }
ok(!!seen, 'post replicated client → host', `(${Date.now() - t0} ms)`)
await post(HOST, `/api/forum/posts/${p.id}/replies`, { body: 'You are not alone, I felt the same in first year.', alias: 'Test Heron' })
await post(HOST, `/api/forum/posts/${p.id}/support`, {})
t0 = Date.now()
let th = null
for (let i = 0; i < 30; i++) { await sleep(500); th = await get(CLIENT, `/api/forum/posts/${p.id}`); if (th.replies?.length && th.post.support) break }
ok(th?.replies?.length === 1 && th.post.support === 1, 'reply + support replicated host → client', `(${Date.now() - t0} ms)`)

// 5. Resources + crisis + UI through the client
const r = await get(CLIENT, '/api/resources?q=counsellor')
ok(r.resources?.length > 0 && r.resources.every((x) => !x.url || /^https?:\/\/[^/]+\.[^/]+/.test(x.url)), 'resource search over P2P (valid links)', r.resources?.[0]?.title)
ok((await get(CLIENT, '/api/crisis')).contacts?.length > 0, 'crisis contacts served')
ok((await (await fetch(CLIENT + '/')).text()).includes('Oasis'), 'UI served through this path')

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
