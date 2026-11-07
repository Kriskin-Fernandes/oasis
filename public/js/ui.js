// Shared UI helpers. No frameworks: everything is plain DOM so it loads
// instantly over a P2P tunnel on a phone.
export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

export function h (tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'html') el.innerHTML = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)))
  return el
}

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** Minimal, safe markdown: escapes everything first, then adds a few inline/blocks. */
export function markdown (src) {
  const lines = escapeHtml(src.replace(/\r/g, '')).split('\n')
  let out = ''; let list = null; let para = []
  const flushPara = () => { if (para.length) { out += `<p>${inline(para.join('<br>'))}</p>`; para = [] } }
  const flushList = () => { if (list) { out += `</${list}>`; list = null } }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const ul = line.match(/^\s*[-*•]\s+(.*)$/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    const hd = line.match(/^#{1,4}\s+(.*)$/)
    if (ul || ol) {
      flushPara()
      const kind = ul ? 'ul' : 'ol'
      if (list !== kind) { flushList(); out += `<${kind}>`; list = kind }
      out += `<li>${inline((ul || ol)[1])}</li>`
    } else if (hd) {
      flushPara(); flushList(); out += `<p><strong>${inline(hd[1])}</strong></p>`
    } else if (!line.trim()) {
      flushPara(); flushList()
    } else {
      flushList(); para.push(line)
    }
  }
  flushPara(); flushList()
  return out
}

function inline (s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
    .replace(/(^|[\s(])([\w.+-]+@[\w-]+\.[\w.-]+[a-z])/gi, '$1<a href="mailto:$2">$2</a>')
}

export function timeAgo (ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`
  return new Date(ts).toLocaleDateString()
}

const ADJ = ['Quiet', 'Gentle', 'Calm', 'Kind', 'Warm', 'Bright', 'Still', 'Brave', 'Hopeful', 'Soft', 'Steady', 'Patient']
const NOUN = ['Fern', 'Willow', 'Moss', 'River', 'Pebble', 'Meadow', 'Robin', 'Cloud', 'Maple', 'Heron', 'Otter', 'Birch', 'Lantern', 'Harbour']
export const randomAlias = () => `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${NOUN[Math.floor(Math.random() * NOUN.length)]}`

// Small persisted settings (this device only).
export const settings = {
  get (k, d) { try { const v = localStorage.getItem('oasis:' + k); return v == null ? d : JSON.parse(v) } catch { return d } },
  set (k, v) { try { localStorage.setItem('oasis:' + k, JSON.stringify(v)) } catch {} }
}

export async function api (path, opts = {}) {
  const res = await fetch(path, { cache: 'no-store', ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // A bare 404 on an /api route means the server process predates this page.
    if (res.status === 404 && data.error === 'not found') throw new Error('The Oasis server on this device is out of date. Restart it (Ctrl+C, then npm run host) and refresh this page.')
    if (res.status === 502) throw new Error("Can't reach the Oasis host right now. Please try again in a moment.")
    throw new Error(data.error || res.statusText || 'Something went wrong')
  }
  return data
}

export function contactCard (c) {
  const body = [h('b', {}, c.name), h('span', {}, c.detail)]
  return c.action ? h('a', { class: 'contact', href: c.action }, ...body) : h('div', { class: 'contact' }, ...body)
}
