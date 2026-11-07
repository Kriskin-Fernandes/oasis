// Safety helpers shared by the AI guide and the forum.
//
// This is a conservative keyword screen, NOT a clinical risk assessment. Its
// only job is to make sure urgent-help contacts are shown immediately and
// prominently, before the model has said anything, when text suggests
// someone may be at risk.
import fs from 'node:fs'

const RISK_PATTERNS = [
  /\bsuicid/i,
  /\bkill(ing)?\s+my\s*self\b/i,
  /\bend(ing)?\s+(my\s+life|it\s+all)\b/i,
  /\b(want|wanna|going)\s+to\s+die\b/i,
  /\bdon'?t\s+want\s+to\s+(be\s+alive|live|wake\s+up)\b/i,
  /\bself[\s-]?harm/i,
  /\b(hurt|hurting|harm|harming|cut|cutting)\s+my\s*self\b/i,
  /\boverdos/i,
  /\bno\s+(reason|point)\s+(to|in)\s+(live|living|going\s+on)\b/i,
  /\bbetter\s+off\s+(dead|without\s+me)\b/i,
  /\bcan'?t\s+go\s+on\b/i,
  /\b(being|been|getting)\s+(abused|assaulted)\b/i,
  /\bnot\s+safe\s+(at\s+home|right\s+now)\b/i
]

export function detectRisk (text) {
  return RISK_PATTERNS.some((re) => re.test(String(text || '')))
}

export function loadCrisisContacts (file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { region: j.region || '', contacts: Array.isArray(j.contacts) ? j.contacts : [] }
  } catch {
    return { region: '', contacts: [{ name: 'Emergency services', detail: 'Contact your local emergency number if you are in immediate danger' }] }
  }
}
