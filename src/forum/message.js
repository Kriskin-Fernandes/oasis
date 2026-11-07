// Forum message format. Messages are immutable and content-addressed: the id
// is a hash of the content, so any peer can verify a message wasn't altered
// in transit and duplicates collapse naturally. No device or user identity is
// stored; `alias` is a random gentle name picked in the browser.
import crypto from 'node:crypto'

export const TAGS = ['workload', 'exams', 'impostor-syndrome', 'bullying', 'loneliness', 'anxiety', 'low-mood', 'other']
export const TYPES = ['post', 'reply', 'support']
export const LIMITS = { title: 120, body: 2000, alias: 40 }
const MAX_FUTURE_MS = 10 * 60 * 1000

const fields = (m) => [m.v, m.type, m.parent, m.title, m.body, m.tag, m.alias, m.ts, m.nonce]
export const hashMessage = (m) => crypto.createHash('sha256').update(JSON.stringify(fields(m))).digest('hex')

export function createMessage ({ type, parent = null, title = '', body = '', tag = 'other', alias = '' }) {
  const m = {
    v: 1,
    type,
    parent: parent || null,
    title: String(title || '').trim().slice(0, LIMITS.title),
    body: String(body || '').trim().slice(0, LIMITS.body),
    tag: TAGS.includes(tag) ? tag : 'other',
    alias: String(alias || '').trim().slice(0, LIMITS.alias) || 'Anonymous',
    // Coarsen timestamps to the minute: less fingerprinting, still sortable.
    ts: Math.floor(Date.now() / 60000) * 60000,
    nonce: crypto.randomBytes(8).toString('hex')
  }
  m.id = hashMessage(m)
  const err = validate(m)
  if (err) throw Object.assign(new Error(err), { status: 400 })
  return m
}

/** Returns an error string, or null if the message is acceptable. */
export function validate (m) {
  if (!m || typeof m !== 'object') return 'not an object'
  if (m.v !== 1) return 'unsupported version'
  if (!TYPES.includes(m.type)) return 'bad type'
  if (typeof m.id !== 'string' || m.id !== hashMessage(m)) return 'id does not match content'
  if (typeof m.ts !== 'number' || m.ts > Date.now() + MAX_FUTURE_MS || m.ts < 1.6e12) return 'bad timestamp'
  if (typeof m.alias !== 'string' || m.alias.length > LIMITS.alias) return 'bad alias'
  if (typeof m.body !== 'string' || m.body.length > LIMITS.body) return 'bad body'
  if (typeof m.title !== 'string' || m.title.length > LIMITS.title) return 'bad title'
  if (!TAGS.includes(m.tag)) return 'bad tag'
  if (m.type === 'post') {
    if (m.parent !== null) return 'post cannot have parent'
    if (!m.title && !m.body) return 'empty post'
  } else {
    if (typeof m.parent !== 'string' || !/^[0-9a-f]{64}$/.test(m.parent)) return 'missing parent'
    if (m.type === 'reply' && !m.body) return 'empty reply'
  }
  return null
}
