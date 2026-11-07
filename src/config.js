// Central configuration. Every value can be overridden with an environment
// variable so the same code runs on a laptop, a desktop GPU box or a phone-
// tethered setup without edits.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d)
const num = (k, d) => (process.env[k] ? Number(process.env[k]) : d)

const HF_REPO = 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main'
const DATA = env('GUH_DATA_DIR', path.join(ROOT, 'data'))

export const config = {
  root: ROOT,
  dataDir: DATA,
  publicDir: path.join(ROOT, 'public'),

  app: {
    name: env('GUH_APP_NAME', 'Oasis'),
    university: env('GUH_UNIVERSITY', 'your university'),
    tagline: env('GUH_TAGLINE', 'A quiet place to talk things through')
  },

  model: {
    // Any llama.cpp-compatible GGUF works: HTTP URL, absolute path, or pear:// key.
    // Q4_K_M (~5.7 GB) is the best quality/size trade-off for 6–8 GB GPUs.
    // Smaller GPUs: set QVAC_MODEL_FILE=Qwen3.5-9B-Q3_K_M.gguf (~4.7 GB).
    src: env('QVAC_MODEL_SRC', `${HF_REPO}/${env('QVAC_MODEL_FILE', 'Qwen3.5-9B-Q4_K_M.gguf')}`),
    name: env('QVAC_MODEL_NAME', 'Qwen3.5-9B (unsloth GGUF)'),
    modelConfig: {
      ctx_size: num('QVAC_CTX_SIZE', 8192),
      // Unset = let QVAC auto-fit layers to free VRAM. Set to pin (0 = CPU only).
      ...(process.env.QVAC_GPU_LAYERS ? { gpu_layers: Number(process.env.QVAC_GPU_LAYERS) } : {}),
      ...(process.env.QVAC_DEVICE ? { device: process.env.QVAC_DEVICE } : {})
    },
    // Fallback prompt for raw /v1 use; the guide builds its own (src/guide/guide.js).
    systemPrompt: 'You are a helpful assistant running 100% locally via QVAC. Be concise.',
    captureThinking: true
  },

  knowledge: {
    // Drop Firecrawl JSON output here. Watched: changes re-index live.
    dir: env('GUH_FIRECRAWL_DIR', path.join(ROOT, 'firecrawl')),
    // Used only while ./firecrawl has no JSON, so the demo still signposts.
    sampleDir: path.join(ROOT, 'examples', 'firecrawl-sample'),
    crisisFile: env('GUH_CRISIS_FILE', path.join(ROOT, 'config', 'crisis-contacts.json'))
  },

  host: {
    // The HTTP API/UI only ever binds to loopback. Remote peers reach it
    // exclusively through the encrypted Holesail tunnel.
    httpHost: '127.0.0.1',
    httpPort: num('GUH_HTTP_PORT', 8787),
    // Persisted so the hs:// connection string survives restarts.
    keyFile: path.join(DATA, 'holesail-host.key'),
    forumFile: path.join(DATA, 'forum-host.jsonl'),
    p2p: env('GUH_P2P', 'on') !== 'off'
  },

  client: {
    host: '127.0.0.1',
    // Where the browser connects on the client device (UI + local forum).
    port: num('GUH_CLIENT_PORT', 8788),
    // Internal port where the Holesail tunnel to the host lands.
    tunnelPort: num('GUH_TUNNEL_PORT', 8789),
    forumFile: path.join(DATA, 'forum-client.jsonl')
  }
}
