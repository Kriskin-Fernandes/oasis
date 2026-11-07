// The wellbeing guide: wraps the raw QVAC engine with
//   1. retrieval over university resources (KnowledgeBase),
//   2. a safety screen that surfaces crisis contacts first,
//   3. a carefully scoped system prompt.
// Transport layers call guide.respond(); they never build prompts themselves.
import { detectRisk } from './safety.js'

export class Guide {
  constructor ({ engine, kb, crisis, appName, university }) {
    this.engine = engine
    this.kb = kb
    this.crisis = crisis
    this.appName = appName
    this.university = university
  }

  systemPrompt (passages, risk) {
    const resources = passages.length
      ? passages.map((p, i) => `[${i + 1}] ${p.doc.title}${p.doc.url ? ` (${p.doc.url})` : ''}\n${p.text}`).join('\n\n---\n\n')
      : '(no matching university resources were found for this message)'
    const crisis = this.crisis.contacts.map((c) => `- ${c.name}: ${c.detail}`).join('\n')

    return `You are ${this.appName}, a calm, warm and non-judgmental wellbeing guide for students at ${this.university}. You run privately on the student's own community hardware; nothing they say is sent to any company.

How to respond:
- Start by briefly acknowledging how they feel, in a human, gentle way. No clichés, no lecturing.
- Offer one to three small, practical next steps.
- Signpost: point them to the most relevant service, person, student council member or ambassador from UNIVERSITY RESOURCES below. Name it, say what it can do for them, and include its link, email or phone exactly as written. Prefer resources over generic advice.
- Never invent names, services, phone numbers, emails or links. Only use details that appear in UNIVERSITY RESOURCES or CRISIS CONTACTS. If nothing fits, suggest the university wellbeing service or a GP in general terms.
- Keep it short: under 160 words, plain language, short paragraphs or a short list. Use **bold** sparingly for service names.
- You are not a therapist or doctor. Do not diagnose. Gently say so only if relevant.
- It's fine to ask one gentle follow-up question.
- If they mention suicide, self-harm, abuse or being in danger: respond with warmth, tell them they deserve support right now, and encourage them to contact one of the CRISIS CONTACTS now. List them. Then offer to stay and talk.${risk ? '\n\nIMPORTANT: this message may indicate the student is at risk. Follow the crisis guidance above first.' : ''}

UNIVERSITY RESOURCES:
${resources}

CRISIS CONTACTS (${this.crisis.region || 'local'}):
${crisis}`
  }

  /**
   * Yields UI events: crisis → sources → (queued | thinking | content | stats | done).
   * `think` turns Qwen's reasoning channel on (slower, sometimes better).
   */
  async * respond (messages, { think = false, signal } = {}) {
    const userTurns = messages.filter((m) => m?.role === 'user').map((m) => String(m.content || ''))
    const latest = userTurns.at(-1) || ''
    // Retrieve on the latest turn plus a little context from the previous one.
    const query = [userTurns.at(-2) || '', latest, latest].join(' ')
    const risk = userTurns.slice(-3).some(detectRisk)

    if (risk) yield { type: 'crisis', contacts: this.crisis.contacts, region: this.crisis.region }

    const { passages, sources } = this.kb.retrieve(query)
    yield { type: 'sources', items: sources }

    // Keep the most recent turns so prompt + resources fit the context window.
    const recent = messages.slice(-12)
    yield * this.engine.chat(recent, {
      system: this.systemPrompt(passages, risk),
      signal,
      generationParams: { reasoning_budget: think ? -1 : 0, temp: 0.6 }
    })
  }
}
