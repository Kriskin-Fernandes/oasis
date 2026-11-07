// QvacEngine — the single place that talks to the QVAC SDK.
//
// It owns the model lifecycle (download → load → ready), exposes a streaming
// chat API, and serialises requests so one GPU-bound model can be shared by
// many peers. Future capabilities (RAG, embeddings, transcription, TTS …) should
// be added here as new methods so the HTTP/P2P layers stay transport-only.
import { EventEmitter } from 'node:events'
import { loadModel, completion, cancel, unloadModel, getSystemResources, close } from '@qvac/sdk'

export class QvacEngine extends EventEmitter {
  constructor (modelCfg) {
    super()
    this.cfg = modelCfg
    this.modelId = null
    this.status = { state: 'idle', progress: 0, error: null, model: modelCfg.name, src: modelCfg.src }
    this.queue = Promise.resolve()
    this.pending = 0
    this.lastStats = null
  }

  #setStatus (patch) {
    Object.assign(this.status, patch)
    this.emit('status', { ...this.status })
  }

  async load () {
    if (this.modelId) return this.modelId
    // Starts as 'loading'; switches to 'downloading' only if bytes actually need fetching.
    this.#setStatus({ state: 'loading', progress: 0, error: null })
    const t0 = Date.now()
    try {
      this.modelId = await loadModel({
        modelSrc: this.cfg.src,
        modelType: 'llamacpp-completion',
        modelConfig: this.cfg.modelConfig,
        onProgress: (p) => {
          const pct = Number(p.percentage) || 0
          // Fires frequently; throttle to 0.5% steps.
          if (pct >= 100) {
            if (this.status.state !== 'loading') this.#setStatus({ state: 'loading', progress: 100 })
          } else if (pct > 0 && (pct - this.status.progress >= 0.5 || this.status.state !== 'downloading')) {
            this.#setStatus({ state: 'downloading', progress: pct, downloaded: p.downloaded, total: p.total })
          }
        }
      })
      this.#setStatus({ state: 'ready', progress: 100, loadMs: Date.now() - t0 })
      return this.modelId
    } catch (err) {
      this.#setStatus({ state: 'error', error: err?.message || String(err) })
      throw err
    }
  }

  /**
   * Streaming chat. Yields { type: 'queued'|'thinking'|'content'|'stats'|'done', ... }.
   * `system` overrides the default system prompt for this request.
   * Requests are queued FIFO so concurrent peers don't fight over the model.
   */
  async * chat (messages, { signal, generationParams, system } = {}) {
    if (!this.modelId) throw new Error(`Model not ready (state: ${this.status.state})`)
    const history = [{ role: 'system', content: system || this.cfg.systemPrompt }, ...sanitize(messages)]

    // Wait for our turn.
    let release
    const turn = new Promise((resolve) => { release = resolve })
    const prev = this.queue
    this.queue = prev.then(() => turn)
    this.pending++
    try {
      const position = this.pending - 1
      if (position > 0) yield { type: 'queued', position }
      await prev
      if (signal?.aborted) return

      const run = completion({
        modelId: this.modelId,
        history,
        stream: true,
        captureThinking: this.cfg.captureThinking,
        ...(generationParams ? { generationParams } : {})
      })
      const onAbort = () => { cancel({ requestId: run.requestId }).catch(() => {}) }
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        for await (const ev of run.events) {
          if (ev.type === 'contentDelta') yield { type: 'content', text: ev.text }
          else if (ev.type === 'thinkingDelta') yield { type: 'thinking', text: ev.text }
          else if (ev.type === 'completionStats') { this.lastStats = ev.stats; yield { type: 'stats', stats: ev.stats } }
          else if (ev.type === 'completionDone') {
            yield { type: 'done', stopReason: ev.stopReason, error: ev.error?.message }
          }
        }
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
    } finally {
      this.pending--
      release()
    }
  }

  /** Non-streaming helper (used by scripts/tests). */
  async chatOnce (messages, opts) {
    let content = ''
    let thinking = ''
    let stats = null
    for await (const ev of this.chat(messages, opts)) {
      if (ev.type === 'content') content += ev.text
      else if (ev.type === 'thinking') thinking += ev.text
      else if (ev.type === 'stats') stats = ev.stats
    }
    return { content, thinking, stats }
  }

  async system () {
    try { return await getSystemResources({ sample: true }) } catch { return null }
  }

  async close () {
    try { if (this.modelId) await unloadModel({ modelId: this.modelId, clearStorage: false }) } catch {}
    this.modelId = null
    try { await close() } catch {}
  }
}

function sanitize (messages) {
  if (!Array.isArray(messages)) throw new Error('messages must be an array')
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content }))
}
