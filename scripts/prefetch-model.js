// Downloads + loads the configured model once so it is cached for later runs.
// Usage: node scripts/prefetch-model.js
import { QvacEngine } from '../src/inference/qvac-engine.js'
import { config } from '../src/config.js'

const engine = new QvacEngine(config.model)
engine.on('status', (s) => {
  if (s.state === 'downloading') process.stderr.write(`\r▸ downloading ${s.progress.toFixed(1)}%   `)
  else console.log(`\n▸ ${s.state}${s.error ? ': ' + s.error : ''}`)
})
await engine.load()
const out = await engine.chatOnce([{ role: 'user', content: 'Reply with exactly: QVAC OK' }])
console.log('▸ model says:', out.content.trim(), `(${out.stats?.tokensPerSecond?.toFixed(1)} tok/s)`)
await engine.close()
