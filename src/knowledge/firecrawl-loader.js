// Turns whatever Firecrawl produced into a flat list of documents.
//
// Firecrawl output comes in several shapes, and users often save it by hand,
// so the loader is deliberately tolerant. Supported:
//   • scrape:  { success, data: { markdown, metadata: { title, sourceURL, … } } }
//   • crawl:   { success, data: [ { markdown, metadata }, … ] }   (or a bare array)
//   • extract: { data: { anything structured, e.g. people: [{ name, role, email }] } }
//   • hand-written: [{ title, url, content|text|description, … }]
// Unknown objects are flattened into "key: value" text so nothing is lost.
import fs from 'node:fs'
import path from 'node:path'

const TEXT_KEYS = ['markdown', 'content', 'text', 'body']
const TITLE_KEYS = ['title', 'name', 'heading', 'service', 'ogTitle']
const URL_KEYS = ['sourceURL', 'url', 'link', 'website', 'ogUrl', 'href']
// Firecrawl response envelope / bookkeeping fields: never content.
const META_KEYS = new Set(['success', 'status', 'statusCode', 'id', 'warning', 'error', 'creditsUsed', 'expiresAt', 'total', 'completed', 'next', 'scrapeId', 'cacheState', 'cachedAt', 'proxyUsed'])
const isMetaKey = (k) => k.startsWith('_') || META_KEYS.has(k)

export function loadFirecrawlDir (dir) {
  const files = []
  const docs = []
  const errors = []
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return { files, docs, errors } }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.json')) continue
    const file = path.join(dir, ent.name)
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'))
      const before = docs.length
      extract(json, { file: ent.name, url: null, title: null }, docs, 0)
      files.push({ name: ent.name, docs: docs.length - before })
    } catch (e) {
      errors.push({ file: ent.name, error: e.message })
    }
  }
  docs.forEach((d, i) => { d.id = `d${i}` })
  return { files, docs, errors }
}

function extract (node, ctx, out, depth) {
  if (depth > 8 || node == null) return
  if (Array.isArray(node)) {
    for (const item of node) extract(item, ctx, out, depth + 1)
    return
  }
  if (typeof node !== 'object') return

  const meta = typeof node.metadata === 'object' && node.metadata ? node.metadata : {}
  const url = pick(node, URL_KEYS) || pick(meta, URL_KEYS) || ctx.url
  const title = pick(node, TITLE_KEYS) || pick(meta, TITLE_KEYS) || ctx.title

  // 1) Page-like object with a main text body.
  const text = pick(node, TEXT_KEYS)
  if (text && text.length > 40) {
    const doc = makeDoc({ title, url, text, description: pick(node, ['description']) || pick(meta, ['description']), file: ctx.file })
    if (doc) out.push(doc)
    return
  }

  // 2) Wrapper objects: { data: … }, { results: … }, { pages: … } etc.
  const childCtx = { ...ctx, url, title }
  const nested = Object.entries(node).filter(([k, v]) => k !== 'metadata' && !isMetaKey(k) && v && typeof v === 'object')
  const prims = Object.entries(node).filter(([k, v]) => !isMetaKey(k) && ['string', 'number'].includes(typeof v) && String(v).trim())

  // 3) Leaf record (e.g. a person, a service): mostly primitive fields.
  if (prims.length >= 2 && nested.length <= prims.length) {
    const lines = prims.map(([k, v]) => `${humanize(k)}: ${v}`)
    for (const [k, v] of nested) {
      if (Array.isArray(v) && v.every((x) => typeof x !== 'object')) lines.push(`${humanize(k)}: ${v.join(', ')}`)
    }
    if (lines.join(' ').length > 30) {
      const role = pick(node, ['role', 'position', 'jobTitle', 'type'])
      const ownTitle = pick(node, TITLE_KEYS) || prims[0][1]
      const doc = makeDoc({ title: role && ownTitle !== role ? `${ownTitle} · ${role}` : ownTitle, url, text: lines.join('\n'), description: pick(node, ['description', 'summary', 'area', 'focus', 'about', 'services']), file: ctx.file, structured: true })
      if (doc) out.push(doc)
    }
    for (const [, v] of nested) if (typeof v === 'object' && !(Array.isArray(v) && v.every((x) => typeof x !== 'object'))) extract(v, childCtx, out, depth + 1)
    return
  }
  for (const [, v] of nested) extract(v, childCtx, out, depth + 1)
}

function makeDoc ({ title, url, text, description, file, structured = false }) {
  const raw = String(text)
  const clean = cleanMarkdown(raw)
  const fixedUrl = repairUrl(url, raw)
  const heading = firstHeading(clean)
  let finalTitle = title || heading || file
  // Titles taken from a page heading ("There is always hope") get the site name
  // so students know who the service is.
  if (!title && heading && fixedUrl) finalTitle = `${heading} · ${siteName(fixedUrl)}`
  finalTitle = String(finalTitle).replace(/[*_`#]/g, '').slice(0, 160).trim()

  // Skip error pages and near-empty scrapes: they only add noise.
  if (!structured && (NOT_FOUND.test(finalTitle) || NOT_FOUND.test(heading || '') || clean.length < 120)) return null

  return {
    title: finalTitle,
    url: fixedUrl,
    description: (description ? String(description) : firstParagraph(clean, heading)).slice(0, 300),
    text: clean,
    file,
    structured
  }
}

const NOT_FOUND = /^(page\s+)?not\s+found\b|\b404\b|page (cannot|can't|could not) be found|page doesn'?t exist/i
const GENERIC_HEADING = /^(search|menu|main menu|navigation|skip|footer|cookies?|cookie settings|share|related|contents|on this page|breadcrumb)\b/i
const TWO_PART_SLD = new Set(['ac', 'co', 'org', 'gov', 'nhs', 'ltd', 'plc', 'me', 'net', 'sch', 'police', 'mod'])
const TLDS = new Set(['com', 'org', 'net', 'edu', 'gov', 'io', 'uk', 'ie', 'info', 'eu', 'us', 'ca', 'au', 'nz', 'de', 'fr', 'nl', 'scot', 'wales', 'app', 'dev'])

/**
 * Some scrapers turn "www.mind.org.uk/help" into "www/mind/org/uk/help".
 * Rebuild the hostname by walking segments until a TLD, then prefer a real
 * absolute link from the page text when one has the same domain.
 */
export function repairUrl (url, rawText = '') {
  if (!url || !/^https?:\/\//i.test(url)) return null
  try {
    const u = new URL(url)
    if (u.hostname.includes('.')) return u.href
    const segs = (u.hostname + u.pathname).split('/').filter(Boolean)
    const host = []
    let i = 0
    for (; i < segs.length; i++) {
      host.push(segs[i])
      const s = segs[i].toLowerCase()
      const next = (segs[i + 1] || '').toLowerCase()
      if (host.length >= 2 && TLDS.has(s) && !(TWO_PART_SLD.has(s) && ['uk', 'au', 'nz', 'za', 'in'].includes(next))) break
    }
    if (i >= segs.length) return null
    const rest = segs.slice(i + 1).join('/')
    const rebuilt = new URL(`${u.protocol}//${host.join('.')}/${rest}${url.endsWith('/') && rest ? '/' : ''}`)
    const bare = rebuilt.hostname.replace(/^www\./, '')
    const m = rawText.match(new RegExp(`https?://(?:www\\.)?${bare.replace(/\./g, '\\.')}(?=[/)#?\\s])`, 'i'))
    if (m) return new URL(rebuilt.pathname + rebuilt.search, new URL(m[0]).origin).href
    return rebuilt.href
  } catch {
    return null
  }
}

function siteName (url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function firstParagraph (md, heading) {
  // Prefer the text right after the page's main heading: banners and consent
  // panels usually come before it.
  const at = heading ? md.indexOf(heading) : -1
  const tryFrom = at > 0 ? [md.slice(at + heading.length), md] : [md]
  for (const part of tryFrom) {
    for (const block of part.split(/\n{2,}/)) {
      const t = block.replace(/^#+\s.*$/gm, '').replace(/[*_>`]/g, '').replace(/\s+/g, ' ').trim()
      if (t.length >= 60 && !/^[-•]/.test(t)) return t
    }
  }
  return md.replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').slice(0, 220)
}

/** Strip the usual scraped-page noise while keeping meaningful text and contacts. */
export function cleanMarkdown (md) {
  const lines = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]*)\]\((mailto:|tel:)([^)]+)\)/gi, (_, t, kind, addr) => (t && !t.includes(addr) ? `${t} (${addr})` : addr)) // keep contacts
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // other links → their text
    .replace(/^\s*(skip to (main )?content|cookie|accept all cookies|reject all|manage cookies).*$/gim, '')
    .replace(/^.*\b(we use cookies|this (web)?site uses cookies|cookie (policy|preferences|settings))\b.*$/gim, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .filter((l) => !/^\s*[-*•]\s*$/.test(l)) // empty bullets from nav menus
  const out = []
  for (const l of lines) if (!(l.trim() && out.some((o, i) => i >= out.length - 40 && o.trim() === l.trim() && l.trim().length > 20))) out.push(l) // repeated lines
  // Drop whole paragraphs that are cookie-consent panels.
  return out.join('\n').split(/\n{2,}/).filter((b) => !/\b(cookies?|hotjar|google analytics|analytics tool|consent|privacy preferences?|tracking technolog\w*|personalised ads)\b/i.test(b)).join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

function firstHeading (md) {
  const heads = [...md.matchAll(/^(#{1,3})\s+(.+)$/gm)].map((m) => ({ level: m[1].length, text: m[2].replace(/[*_`]/g, '').trim() }))
  const good = heads.filter((x) => !GENERIC_HEADING.test(x.text) && x.text.length > 2)
  const h1 = good.find((x) => x.level === 1)
  return (h1 || good[0])?.text || null
}

function pick (obj, keys) {
  for (const k of keys) if (typeof obj?.[k] === 'string' && obj[k].trim()) return obj[k].trim()
  return null
}

function humanize (k) {
  return k.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}
