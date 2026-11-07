// Small, dependency-free BM25 index. It's fast enough for thousands of chunks
// and runs entirely in-process, so nothing about the student's question leaves
// the device. It can be swapped for QVAC embeddings/RAG (ragIngest/ragSearch)
// later without changing callers: the interface is just build() + search().

const STOP = new Set('a an and are as at be been but by can could do does for from had has have how i if im in into is it its just me my of on or our so than that the their them then there these they this to too us was we were what when where which who why will with would you your am not no yes ive dont cant really very much feel feeling get got been being about'.split(' '))

// Light query expansion so everyday words find the right services.
const SYNONYMS = {
  stress: ['stressed', 'pressure', 'overwhelmed', 'anxiety'],
  overwhelmed: ['stress', 'workload'],
  workload: ['deadline', 'deadlines', 'assignment', 'coursework', 'extension', 'academic'],
  deadline: ['extension', 'workload', 'coursework'],
  exam: ['exams', 'assessment', 'revision', 'anxiety'],
  anxious: ['anxiety', 'panic', 'worry'],
  anxiety: ['anxious', 'panic', 'worry'],
  sad: ['depression', 'low', 'mood'],
  depressed: ['depression', 'low', 'mood'],
  lonely: ['loneliness', 'isolation', 'friends', 'social', 'societies'],
  bullied: ['bullying', 'harassment', 'report'],
  bullying: ['harassment', 'report', 'conduct'],
  harassed: ['harassment', 'bullying', 'report'],
  impostor: ['imposter', 'confidence', 'belong', 'selfesteem'],
  imposter: ['impostor', 'confidence', 'belong'],
  belong: ['impostor', 'confidence', 'community'],
  sleep: ['insomnia', 'tired', 'rest'],
  money: ['financial', 'hardship', 'funding', 'bursary'],
  counselling: ['counseling', 'counsellor', 'counsellingservice', 'therapy', 'support'],
  counsellor: ['counselling', 'counseling', 'counsellingservice', 'therapy', 'appointment'],
  counselor: ['counselling', 'counseling', 'counsellingservice', 'therapy'],
  therapist: ['counselling', 'therapy', 'counsellor'],
  therapy: ['counselling', 'therapist'],
  uni: ['university', 'student', 'campus'],
  university: ['student', 'campus'],
  gp: ['doctor', 'nhs'],
  doctor: ['gp', 'nhs'],
  night: ['24', '7', 'anytime', 'nightline'],
  talk: ['counselling', 'listening', 'peer', 'support'],
  suicidal: ['crisis', 'emergency', 'urgent', 'samaritans'],
  crisis: ['emergency', 'urgent']
}

export function tokenize (text) {
  return String(text).toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem)
}

function stem (t) {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3)
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y'
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1)
  return t
}

export class Bm25Index {
  constructor ({ k1 = 1.4, b = 0.75 } = {}) {
    this.k1 = k1; this.b = b
    this.items = []; this.df = new Map(); this.avgLen = 0
  }

  build (items, getText) {
    this.items = items.map((item) => {
      const toks = tokenize(getText(item))
      const tf = new Map()
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1)
      return { item, tf, len: toks.length }
    })
    this.df = new Map()
    for (const { tf } of this.items) for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1)
    this.avgLen = this.items.reduce((a, x) => a + x.len, 0) / (this.items.length || 1)
    return this
  }

  search (query, limit = 5) {
    const base = tokenize(query)
    const weights = new Map()
    for (const t of base) {
      weights.set(t, 1)
      for (const s of SYNONYMS[t] || []) if (!weights.has(stem(s))) weights.set(stem(s), 0.4)
    }
    const N = this.items.length
    const scored = []
    for (const doc of this.items) {
      let score = 0
      for (const [t, w] of weights) {
        const f = doc.tf.get(t)
        if (!f) continue
        const df = this.df.get(t) || 0
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
        score += w * idf * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * doc.len / this.avgLen))
      }
      if (score > 0) scored.push({ score, item: doc.item })
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit)
  }
}
