// Forum API. Served by EVERY node from its own local ForumNode, so posting and
// reading never depends on the host being reachable.
import { json, readJson } from './http.js'
import { TAGS, LIMITS } from '../forum/message.js'

// Simple per-node flood protection (the browser and node are on the same device).
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 12

export function forumRoutes (forum) {
  const recent = []
  const rateLimit = () => {
    const now = Date.now()
    while (recent.length && now - recent[0] > WINDOW_MS) recent.shift()
    if (recent.length >= MAX_PER_WINDOW) throw Object.assign(new Error('Slow down a little: too many posts in a minute.'), { status: 429 })
    recent.push(now)
  }

  return [
    { method: 'GET', path: '/api/forum/meta', handler: (req, res) => json(res, 200, { tags: TAGS, limits: LIMITS, status: forum.status() }) },
    { method: 'GET', path: '/api/forum/posts', handler: (req, res, p, url) => json(res, 200, { posts: forum.list({ tag: url.searchParams.get('tag') || undefined }), status: forum.status() }) },
    {
      method: 'GET',
      path: '/api/forum/posts/:id',
      handler: (req, res, { id }) => {
        const t = forum.thread(id)
        t ? json(res, 200, t) : json(res, 404, { error: 'post not found (it may still be syncing)' })
      }
    },
    {
      method: 'POST',
      path: '/api/forum/posts',
      handler: async (req, res) => {
        const b = await readJson(req)
        rateLimit()
        json(res, 201, forum.publish({ type: 'post', title: b.title, body: b.body, tag: b.tag, alias: b.alias }))
      }
    },
    {
      method: 'POST',
      path: '/api/forum/posts/:id/replies',
      handler: async (req, res, { id }) => {
        const b = await readJson(req)
        rateLimit()
        json(res, 201, forum.publish({ type: 'reply', parent: id, body: b.body, alias: b.alias }))
      }
    },
    {
      method: 'POST',
      path: '/api/forum/posts/:id/support',
      handler: async (req, res, { id }) => { rateLimit(); json(res, 201, forum.publish({ type: 'support', parent: id })) }
    }
  ]
}
