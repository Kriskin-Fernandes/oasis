// Host-only routes: the AI guide, resources and model/hardware status.
// Client nodes reach these through the Holesail tunnel (see client.js).
import os from 'node:os'
import { json, sse, readJson, clientGone } from './http.js'
import { APP_VERSION, API_LEVEL } from '../version.js'

export function guideRoutes ({ engine, guide, kb, crisis, app, getP2P, getForum, port, log }) {
  const startedAt = Date.now()
  let sysCache = { at: 0, data: null }

  const status = async (req) => {
    if (Date.now() - sysCache.at > 10_000) sysCache = { at: Date.now(), data: await engine.system() }
    return {
      app,
      version: APP_VERSION,
      api: API_LEVEL,
      node: { role: 'host' },
      host: { name: os.hostname(), platform: `${os.platform()} ${os.arch()}`, cpus: os.cpus().length, memGB: +(os.totalmem() / 2 ** 30).toFixed(1), uptimeS: Math.round((Date.now() - startedAt) / 1000) },
      model: { ...engine.status, pending: engine.pending, lastStats: engine.lastStats },
      system: sysCache.data,
      knowledge: kb.stats(),
      p2p: getP2P(),
      forum: getForum(),
      you: { via: via(req, port) }
    }
  }

  return [
    { method: 'GET', path: '/api/health', handler: (req, res) => json(res, 200, { ok: true, app: app.name, role: 'host', version: APP_VERSION, api: API_LEVEL, host: os.hostname(), via: via(req, port) }) },
    { method: 'GET', path: '/api/ping', handler: (req, res) => json(res, 200, { t: Date.now() }) },
    { method: 'GET', path: '/api/status', handler: async (req, res) => json(res, 200, await status(req)) },
    { method: 'GET', path: '/api/crisis', handler: (req, res) => json(res, 200, crisis) },
    {
      method: 'GET',
      path: '/api/resources',
      handler: (req, res, p, url) => json(res, 200, { resources: kb.list(url.searchParams.get('q') || ''), knowledge: kb.stats() })
    },
    {
      method: 'POST',
      path: '/api/chat',
      handler: async (req, res) => {
        const body = await readJson(req)
        const tag = `[guide ${via(req, port)}]`
        log(`${tag} ${body.messages?.length ?? 0} msgs${body.think ? ' (deep thinking)' : ''}`) // never log content
        const send = sse(res)
        const t0 = Date.now()
        try {
          for await (const ev of guide.respond(body.messages || [], { think: !!body.think, signal: clientGone(res) })) send(ev)
        } catch (e) {
          send({ type: 'error', error: e.message })
        }
        log(`${tag} done in ${Date.now() - t0} ms`)
        res.end()
      }
    },

    // OpenAI-compatible subset over the raw model (no guide prompt), for tools.
    { method: 'GET', path: '/v1/models', handler: (req, res) => json(res, 200, { object: 'list', data: [{ id: 'local', object: 'model', owned_by: 'qvac', name: engine.status.model }] }) },
    {
      method: 'POST',
      path: '/v1/chat/completions',
      handler: async (req, res) => {
        const body = await readJson(req)
        const id = 'chatcmpl-' + Date.now().toString(36)
        const created = Math.floor(Date.now() / 1000)
        const msgs = body.messages || []
        const system = msgs.find((m) => m.role === 'system')?.content
        const generationParams = { reasoning_budget: body.reasoning_budget ?? 0, ...(body.max_tokens ? { predict: body.max_tokens } : {}), ...(body.temperature != null ? { temp: body.temperature } : {}) }
        const gen = engine.chat(msgs.filter((m) => m.role !== 'system'), { system, generationParams, signal: clientGone(res) })
        if (body.stream) {
          const send = sse(res)
          const chunk = (delta, finish = null) => send({ id, object: 'chat.completion.chunk', created, model: 'local', choices: [{ index: 0, delta, finish_reason: finish }] })
          for await (const ev of gen) {
            if (ev.type === 'content') chunk({ content: ev.text })
            else if (ev.type === 'thinking') chunk({ reasoning_content: ev.text })
            else if (ev.type === 'done') chunk({}, ev.stopReason === 'length' ? 'length' : 'stop')
          }
          res.end('data: [DONE]\n\n')
        } else {
          let content = ''; let reasoning = ''; let finish = 'stop'
          for await (const ev of gen) {
            if (ev.type === 'content') content += ev.text
            else if (ev.type === 'thinking') reasoning += ev.text
            else if (ev.type === 'done' && ev.stopReason === 'length') finish = 'length'
          }
          json(res, 200, { id, object: 'chat.completion', created, model: 'local', choices: [{ index: 0, message: { role: 'assistant', content, ...(reasoning ? { reasoning_content: reasoning } : {}) }, finish_reason: finish }] })
        }
      }
    }
  ]
}

/**
 * Did this request arrive over P2P? Client nodes tag proxied requests with
 * x-guh-via. Plain Holesail clients (e.g. a phone app) can't add headers, but
 * the browser's Host header keeps the client-side port, which differs from ours.
 * Display only; never use this for authorization.
 */
export function via (req, port) {
  if (req.headers['x-guh-via'] === 'p2p-tunnel') return 'p2p-tunnel'
  const p = Number((req.headers.host || '').split(':').pop())
  return p && p !== port ? 'p2p-tunnel' : 'local'
}
