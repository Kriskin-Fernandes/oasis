// ForumNode: an anonymous community board with no server.
//
// Every participant (host or client) runs one. Nodes find each other on the
// Hyperswarm DHT under a topic derived from the community secret, open
// Noise-encrypted connections, and gossip messages:
//
//   on connect   → send  {t:'have', ids:[…]}          (what I already hold)
//   on 'have'    → reply {t:'msgs', msgs:[…]}          (what they're missing)
//   on new post  → flood {t:'msgs', msgs:[m]}          (to every peer)
//   on 'msgs'    → validate, store, re-flood the new ones
//
// Messages are content-addressed (see message.js), so the result converges to
// the same set on every node, and the board stays readable and writable while
// the host is offline. Storage is an append-only JSONL file per node.
//
// The interface (start / publish / list / thread / status / close) is what the
// HTTP layer uses. It's small enough to swap for Autobase/Hypercore later.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import Hyperswarm from 'hyperswarm'
import { validate, createMessage } from './message.js'
import { detectRisk } from '../guide/safety.js'

const MAX_LINE = 2 * 1024 * 1024
const BATCH = 200

export function forumTopic (secret) {
  return crypto.createHash('sha256').update('guh-forum-v1:' + String(secret)).digest()
}

export class ForumNode extends EventEmitter {
  constructor ({ secret, storageFile, log = () => {} }) {
    super()
    this.topic = forumTopic(secret)
    this.storageFile = storageFile
    this.log = log
    this.msgs = new Map()
    this.peers = new Set()
    this.swarm = null
    this.state = 'stopped'
    this.stats = { received: 0, sent: 0, rejected: 0 }
  }

  async start () {
    this.#loadFromDisk()
    this.swarm = new Hyperswarm()
    this.swarm.on('connection', (conn) => this.#onConnection(conn))
    this.state = 'joining'
    this.discovery = this.swarm.join(this.topic, { server: true, client: true })
    // Announcing can take a few seconds; don't block startup on it.
    this.discovery.flushed().then(() => { this.state = 'online' }).catch((e) => { this.state = 'error'; this.log('forum join failed:', e.message) })
    // If two nodes join at the same moment, each may look the topic up before
    // the other has announced. Re-query while we're alone so they always meet.
    // Every 5 s for the first 2 minutes, then every 30 s.
    const startedAt = Date.now()
    let tick = 0
    this.retry = setInterval(() => {
      tick++
      const early = Date.now() - startedAt < 120_000
      if (this.peers.size === 0 && this.state === 'online' && (early || tick % 6 === 0)) {
        this.discovery.refresh({ client: true, server: false }).catch(() => {})
      }
    }, 5_000)
    this.retry.unref?.()
    return this
  }

  // ── public API ────────────────────────────────────────────────────────────
  publish (input) {
    const m = createMessage(input)
    if (m.parent && !this.msgs.has(m.parent)) throw Object.assign(new Error('unknown parent post'), { status: 404 })
    this.#store([m])
    this.#broadcast([m])
    return m
  }

  list ({ tag } = {}) {
    const all = [...this.msgs.values()]
    const replies = new Map(); const support = new Map(); const lastActivity = new Map()
    for (const m of all) {
      if (m.type === 'reply') replies.set(m.parent, (replies.get(m.parent) || 0) + 1)
      if (m.type === 'support') support.set(m.parent, (support.get(m.parent) || 0) + 1)
      if (m.parent) lastActivity.set(m.parent, Math.max(lastActivity.get(m.parent) || 0, m.ts))
    }
    return all
      .filter((m) => m.type === 'post' && (!tag || m.tag === tag))
      .map((m) => ({ ...this.#view(m), replies: replies.get(m.id) || 0, support: support.get(m.id) || 0, active: Math.max(m.ts, lastActivity.get(m.id) || 0) }))
      .sort((a, b) => b.active - a.active)
  }

  thread (id) {
    const post = this.msgs.get(id)
    if (!post || post.type !== 'post') return null
    const children = [...this.msgs.values()].filter((m) => m.parent === id)
    const supportFor = (pid) => children.filter((m) => m.type === 'support' && m.parent === pid).length
    return {
      post: { ...this.#view(post), support: supportFor(id) },
      replies: children.filter((m) => m.type === 'reply').sort((a, b) => a.ts - b.ts).map((m) => this.#view(m))
    }
  }

  status () {
    return {
      state: this.state,
      peers: this.peers.size,
      posts: [...this.msgs.values()].filter((m) => m.type === 'post').length,
      messages: this.msgs.size,
      topic: this.topic.toString('hex').slice(0, 12) + '…',
      ...this.stats
    }
  }

  async close () {
    clearInterval(this.retry)
    for (const c of this.peers) c.destroy()
    await this.swarm?.destroy()
    this.state = 'stopped'
  }

  // ── internals ─────────────────────────────────────────────────────────────
  #view (m) {
    return { id: m.id, type: m.type, parent: m.parent, title: m.title, body: m.body, tag: m.tag, alias: m.alias, ts: m.ts, concern: detectRisk(`${m.title} ${m.body}`) }
  }

  #loadFromDisk () {
    fs.mkdirSync(path.dirname(this.storageFile), { recursive: true })
    let lines = []
    try { lines = fs.readFileSync(this.storageFile, 'utf8').split('\n') } catch {}
    for (const line of lines) {
      if (!line.trim()) continue
      try { const m = JSON.parse(line); if (!validate(m)) this.msgs.set(m.id, m) } catch {}
    }
  }

  /** Store validated, previously-unseen messages. Returns the new ones. */
  #store (msgs) {
    const fresh = []
    for (const m of msgs) {
      if (this.msgs.has(m?.id)) continue
      const err = validate(m)
      if (err) { this.stats.rejected++; continue }
      const clean = { v: m.v, id: m.id, type: m.type, parent: m.parent, title: m.title, body: m.body, tag: m.tag, alias: m.alias, ts: m.ts, nonce: m.nonce }
      this.msgs.set(clean.id, clean)
      fresh.push(clean)
    }
    if (fresh.length) {
      fs.appendFileSync(this.storageFile, fresh.map((m) => JSON.stringify(m)).join('\n') + '\n')
      this.emit('update', fresh)
    }
    return fresh
  }

  #broadcast (msgs, except = null) {
    for (const conn of this.peers) if (conn !== except) this.#send(conn, { t: 'msgs', msgs })
  }

  #send (conn, frame) {
    if (frame.t === 'msgs') {
      for (let i = 0; i < frame.msgs.length; i += BATCH) {
        const part = frame.msgs.slice(i, i + BATCH)
        conn.write(JSON.stringify({ t: 'msgs', msgs: part }) + '\n')
        this.stats.sent += part.length
      }
    } else {
      conn.write(JSON.stringify(frame) + '\n')
    }
  }

  #onConnection (conn) {
    this.peers.add(conn)
    this.log(`forum: peer connected (${this.peers.size} total)`)
    let buf = ''
    conn.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      if (buf.length > MAX_LINE) { conn.destroy(); return }
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1)
        if (line) this.#onFrame(conn, line)
      }
    })
    conn.on('error', () => {})
    conn.on('close', () => {
      this.peers.delete(conn)
      this.log(`forum: peer disconnected (${this.peers.size} total)`)
    })
    this.#send(conn, { t: 'have', ids: [...this.msgs.keys()] })
  }

  #onFrame (conn, line) {
    let f
    try { f = JSON.parse(line) } catch { return }
    if (f.t === 'have' && Array.isArray(f.ids)) {
      const theirs = new Set(f.ids)
      const missing = [...this.msgs.values()].filter((m) => !theirs.has(m.id))
      // Send parents before children so receivers can show threads immediately.
      missing.sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0) || a.ts - b.ts)
      if (missing.length) this.#send(conn, { t: 'msgs', msgs: missing })
    } else if (f.t === 'msgs' && Array.isArray(f.msgs)) {
      this.stats.received += f.msgs.length
      const fresh = this.#store(f.msgs)
      if (fresh.length) this.#broadcast(fresh, conn)
    }
  }
}
