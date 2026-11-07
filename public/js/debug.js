// System details drawer: every technical detail lives here, out of the way of
// students. Useful for demos and judging: proves local inference + P2P.
import { $, h, settings } from './ui.js'

const fmtGB = (b) => (b == null ? '?' : (b / 2 ** 30).toFixed(1) + ' GB')
const metric = (m) => (m && m.status === 'supported' ? m.value : undefined)
let lastPing = null

export function renderDebug (s, store) {
  const body = $('#debug-body')
  if (!body || $('#debug-sheet').hidden) return
  const m = s.model || {}
  const gpus = metric(s.system?.capabilities?.gpus) || []
  const samples = metric(s.system?.sample?.gpus) || []
  const lc = store.lastChat
  const p2p = s.p2p || {}
  const f = s.forum || {}
  const k = s.knowledge || {}
  const role = s.node?.role || 'host'

  body.innerHTML = ''
  body.append(
    section('Connection',
      dl(['This device', role === 'client' ? 'Client node' : 'Host node (runs the AI)'],
        ['Reached via', s.you?.via === 'p2p-tunnel' ? okText('Holesail P2P tunnel') : 'Local (same machine as the host)'],
        role === 'client' ? ['Host reachable', s.node.hostReachable ? okText(`yes (${s.node.hostRttMs} ms status RTT)`) : errText('no')] : null,
        ['Ping', lastPing || '—']),
      h('button', { class: 'small-btn', type: 'button', onclick: () => ping(store) }, 'Ping host ×5')),

    section('Local AI (QVAC)',
      dl(['Model', m.model || '—'],
        ['State', m.state === 'ready' ? okText('ready') : m.state === 'error' ? errText(m.error || 'error') : (m.state || '—') + (m.state === 'downloading' ? ` ${(m.progress || 0).toFixed(1)}%` : '')],
        m.loadMs ? ['Load time', `${(m.loadMs / 1000).toFixed(1)} s`] : null,
        ['In flight', String(m.pending ?? 0)],
        lc ? ['Last reply', `${lc.tokensPerSecond?.toFixed(1)} tok/s · ${lc.generatedTokens} tokens · first token ${(lc.timeToFirstToken / 1000).toFixed(2)} s · on ${String(lc.backendDevice || '?').toUpperCase()}`] : m.lastStats ? ['Last reply', `${m.lastStats.tokensPerSecond?.toFixed(1)} tok/s on ${String(m.lastStats.backendDevice || '?').toUpperCase()}`] : null,
        ['Source', h('code', {}, m.src || '—')]),
      m.state === 'downloading' ? h('div', { class: 'bar' }, h('i', { style: `width:${m.progress || 0}%` })) : null),

    section('Host hardware',
      dl(['Machine', s.host ? `${s.host.name} · ${s.host.platform}` : '—'],
        ['CPU / RAM', s.host ? `${s.host.cpus} threads · ${s.host.memGB} GB` : '—'],
        ...gpus.map((g) => {
          const smp = samples.find((x) => x.id === g.id)
          const used = metric(smp?.memoryUsedBytes); const total = metric(g.memoryTotalBytes)
          return ['GPU', `${metric(g.name) || g.id}${total ? ` · ${used != null ? fmtGB(used) + ' / ' : ''}${fmtGB(total)} VRAM` : ''}`]
        }),
        ['Uptime', s.host ? `${Math.round(s.host.uptimeS / 60)} min` : '—'])),

    section('Holesail tunnel (AI over P2P)',
      dl(['State', p2p.state === 'listening' ? okText('listening on DHT') : (p2p.state || '—')],
        ['Open connections', String(p2p.peers ?? 0)],
        p2p.peerIds?.length ? ['Peers', p2p.peerIds.join(', ')] : null,
        s.clientTunnel ? ['This client', `${s.clientTunnel.state} (local port ${s.clientTunnel.localPort})`] : null),
      p2p.url || s.clientTunnel?.url ? h('div', {}, h('code', {}, p2p.url || s.clientTunnel.url), h('button', { class: 'small-btn', type: 'button', onclick: () => navigator.clipboard?.writeText(p2p.url || s.clientTunnel.url) }, 'Copy invite')) : null),

    section('Community forum (Hyperswarm)',
      dl(['State', f.state === 'online' ? okText('online') : (f.state || '—')],
        ['Peers', String(f.peers ?? 0)],
        ['Posts / messages', `${f.posts ?? 0} / ${f.messages ?? 0}`],
        ['Synced in / out', `${f.received ?? 0} / ${f.sent ?? 0}${f.rejected ? ` · ${f.rejected} rejected` : ''}`],
        ['Topic', h('code', {}, f.topic || '—')])),

    section('Knowledge (Firecrawl)',
      dl(['Documents', `${k.docs ?? 0} (${k.chunks ?? 0} chunks)`],
        ['Files', (k.files || []).map((x) => `${x.name} (${x.docs})`).join(', ') || 'none'],
        ['Source', k.usingSample ? 'SAMPLE data (./firecrawl is empty)' : './firecrawl'],
        k.errors?.length ? ['Errors', errText(k.errors.map((e) => `${e.file}: ${e.error}`).join('; '))] : null)),

    section('Options',
      toggle('Deep thinking (slower, more considered replies)', 'deepThinking'),
      toggle("Show the model's reasoning", 'showReasoning')),

    section('Raw status', h('details', {}, h('summary', {}, 'JSON'), h('pre', {}, JSON.stringify(s, null, 2))))
  )
}

async function ping (store) {
  const t = []
  for (let i = 0; i < 5; i++) { const t0 = performance.now(); await fetch('/api/ping', { cache: 'no-store' }).catch(() => {}); t.push(performance.now() - t0) }
  t.sort((a, b) => a - b)
  lastPing = `median ${t[2].toFixed(1)} ms · min ${t[0].toFixed(1)} ms`
  if (store.status) renderDebug(store.status, store)
}

const section = (title, ...kids) => h('section', {}, h('h3', {}, title), ...kids)
const dl = (...rows) => h('dl', {}, rows.filter(Boolean).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))
const okText = (t) => h('span', { class: 'ok-text' }, t)
const errText = (t) => h('span', { class: 'err-text' }, t)
function toggle (label, key) {
  const input = h('input', { type: 'checkbox', onchange: (e) => settings.set(key, e.target.checked) })
  input.checked = settings.get(key, false)
  return h('label', {}, input, label)
}
