// KnowledgeBase: university wellbeing resources the guide can signpost to.
//
// Source of truth is the ./firecrawl folder (JSON produced by Firecrawl). The
// folder is watched, so dropping in new files re-indexes without a restart.
// If it has no JSON yet, a clearly-labelled sample set is used so the demo
// still shows signposting end to end.
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { loadFirecrawlDir } from './firecrawl-loader.js'
import { Bm25Index } from './search.js'

const CHUNK_CHARS = 900

export class KnowledgeBase extends EventEmitter {
  constructor ({ dir, sampleDir }) {
    super()
    this.dir = dir
    this.sampleDir = sampleDir
    this.docs = []
    this.chunks = []
    this.meta = { files: [], errors: [], usingSample: false, loadedAt: null }
    this.chunkIndex = new Bm25Index()
    this.docIndex = new Bm25Index()
    this.watcher = null
  }

  load () {
    fs.mkdirSync(this.dir, { recursive: true })
    let res = loadFirecrawlDir(this.dir)
    let usingSample = false
    if (res.docs.length === 0 && this.sampleDir) {
      const sample = loadFirecrawlDir(this.sampleDir)
      if (sample.docs.length) { res = { ...sample, errors: [...res.errors, ...sample.errors] }; usingSample = true }
    }
    this.docs = res.docs
    this.chunks = this.docs.flatMap((d) => chunk(d))
    this.chunkIndex.build(this.chunks, (c) => `${c.doc.title} ${c.doc.title} ${urlWords(c.doc.url)} ${c.text}`)
    this.docIndex.build(this.docs, (d) => `${d.title} ${d.title} ${urlWords(d.url)} ${d.description} ${d.text.slice(0, 4000)}`)
    this.meta = { files: res.files, errors: res.errors, usingSample, loadedAt: new Date().toISOString() }
    this.emit('loaded', this.stats())
    return this.stats()
  }

  watch () {
    if (this.watcher) return
    let t = null
    try {
      this.watcher = fs.watch(this.dir, () => {
        clearTimeout(t)
        t = setTimeout(() => { try { this.load() } catch (e) { this.emit('error', e) } }, 800)
      })
    } catch { /* watching is best-effort (e.g. some network drives) */ }
  }

  stats () {
    return { docs: this.docs.length, chunks: this.chunks.length, ...this.meta }
  }

  /** Best passages for the guide's prompt, plus the distinct sources they came from. */
  retrieve (query, { limit = 5, maxChars = 3200 } = {}) {
    const hits = boost(this.chunkIndex.search(query, limit * 3), (c) => c.doc)
    const passages = []
    let used = 0
    for (const { item, score } of hits) {
      if (passages.length >= limit || used + item.text.length > maxChars) continue
      passages.push({ ...item, score })
      used += item.text.length
    }
    const seen = new Map()
    for (const p of passages) if (!seen.has(p.doc.id)) seen.set(p.doc.id, publicDoc(p.doc))
    return { passages, sources: [...seen.values()] }
  }

  /** Resources tab: browse/search at document level. */
  list (query, limit = 50) {
    const docs = query ? boost(this.docIndex.search(query, limit), (d) => d).map((h) => h.item) : [...this.docs].sort((a, b) => isUniversity(b) - isUniversity(a)).slice(0, limit)
    return docs.map(publicDoc)
  }

  close () { this.watcher?.close() }
}

// University pages are what the guide should signpost first.
const isUniversity = (d) => /\.(ac\.uk|edu|edu\.[a-z]{2}|ac\.[a-z]{2})$/i.test(hostOf(d.url)) ? 1 : 0
const hostOf = (u) => { try { return new URL(u).hostname } catch { return '' } }
const urlWords = (u) => { try { const x = new URL(u); return (x.hostname + x.pathname).replace(/[^a-z0-9]+/gi, ' ') } catch { return '' } }
function boost (hits, docOf) {
  return hits.map((h) => ({ ...h, score: h.score * (isUniversity(docOf(h.item)) ? 1.3 : 1) })).sort((a, b) => b.score - a.score)
}

function publicDoc (d) {
  const summary = d.description || d.text.replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').slice(0, 220)
  return { id: d.id, title: d.title, url: d.url, summary, file: d.file }
}

function chunk (doc) {
  // Split on headings/paragraphs, then pack paragraphs into ~CHUNK_CHARS chunks.
  const parts = doc.text.split(/\n(?=#{1,4}\s)|\n{2,}/).map((s) => s.trim()).filter(Boolean)
  const chunks = []
  let cur = ''
  for (const p of parts) {
    if (cur && cur.length + p.length > CHUNK_CHARS) { chunks.push(cur); cur = '' }
    cur = cur ? `${cur}\n\n${p}` : p
    while (cur.length > CHUNK_CHARS * 1.6) { chunks.push(cur.slice(0, CHUNK_CHARS)); cur = cur.slice(CHUNK_CHARS) }
  }
  if (cur) chunks.push(cur)
  return chunks.map((text, i) => ({ id: `${doc.id}:${i}`, text, doc }))
}
