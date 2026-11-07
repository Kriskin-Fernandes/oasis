// Talk: one-to-one conversation with the local AI guide.
// The conversation lives only in this tab's memory: nothing is stored, and
// closing the tab forgets it.
import { $, h, markdown, settings, contactCard } from './ui.js'

const history = []
let busy = false
let controller = null
let modelReady = false

export function initTalk (store) {
  const form = $('#talk-form')
  const input = $('#talk-input')

  input.addEventListener('input', () => autosize(input))
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); form.requestSubmit() }
  })
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const text = input.value.trim()
    if (!text || busy) return
    input.value = ''; autosize(input)
    send(text, store)
  })
  $('#talk-stop').addEventListener('click', () => controller?.abort())
  $('#talk-new').addEventListener('click', () => {
    controller?.abort()
    history.length = 0
    $('#messages').innerHTML = ''
    $('#talk-empty').hidden = false
    $('#talk-new').hidden = true
  })
  $('#suggestions').addEventListener('click', (e) => {
    if (e.target.matches('.chip')) { input.value = e.target.textContent; form.requestSubmit() }
  })

  store.on('status', (s) => renderNotice(s))
}

function renderNotice (s) {
  const n = $('#talk-notice')
  const m = s.model || {}
  modelReady = m.state === 'ready'
  if (s.node?.role === 'client' && !s.node.hostReachable) {
    n.hidden = false
    n.textContent = "Can't reach Oasis's host right now. The Community tab still works. Try again in a moment."
  } else if (m.state === 'downloading' || m.state === 'loading' || m.state === 'idle') {
    n.hidden = false
    const pct = m.state === 'downloading' ? m.progress || 0 : 100
    n.innerHTML = ''
    n.append(h('span', {}, m.state === 'downloading' ? `Oasis is getting ready… ${pct.toFixed(0)}%` : 'Oasis is waking up…'), h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })))
  } else if (m.state === 'error') {
    n.hidden = false; n.textContent = 'Oasis had trouble starting. See System details for more.'
  } else n.hidden = true
  $('#talk-send').disabled = busy || !modelReady
}

function autosize (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }

function scrollDown () { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }) }

async function send (text, store) {
  $('#talk-empty').hidden = true
  $('#talk-new').hidden = false
  const list = $('#messages')
  history.push({ role: 'user', content: text })
  list.append(h('div', { class: 'msg user' }, text))

  const reasoning = h('div', { class: 'reasoning', hidden: true })
  const content = h('div', { class: 'content' }, h('span', { class: 'typing', 'aria-label': 'Oasis is writing' }, h('i'), h('i'), h('i')))
  const bubble = h('div', { class: 'msg bot' }, reasoning, content)
  list.append(bubble)
  scrollDown()

  let answer = ''
  let sources = []
  const showReasoning = settings.get('showReasoning', false)
  setBusy(true)
  controller = new AbortController()
  const t0 = performance.now()

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: history, think: settings.get('deepThinking', false) }),
      signal: controller.signal
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't reach Oasis")
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += value
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2)
        if (!line.startsWith('data: ')) continue
        const ev = JSON.parse(line.slice(6))
        if (ev.type === 'crisis') {
          list.insertBefore(crisisCard(ev.contacts), bubble)
        } else if (ev.type === 'sources') {
          sources = ev.items || []
        } else if (ev.type === 'thinking' && showReasoning) {
          reasoning.hidden = false; reasoning.textContent += ev.text; reasoning.scrollTop = reasoning.scrollHeight
        } else if (ev.type === 'content') {
          answer += ev.text
          content.innerHTML = markdown(answer.trimStart())
        } else if (ev.type === 'stats') {
          store.lastChat = { ...ev.stats, totalMs: performance.now() - t0 }
        } else if (ev.type === 'error' || (ev.type === 'done' && ev.error)) {
          throw new Error(ev.error)
        }
      }
      scrollDown()
    }
    if (!answer.trim()) content.innerHTML = '<span class="err">Oasis didn\'t manage a reply that time. Please try again.</span>'
  } catch (e) {
    if (e.name === 'AbortError') {
      if (!answer) content.innerHTML = '<span class="err">Stopped.</span>'
    } else {
      content.innerHTML = (answer ? markdown(answer) : '') + `<p class="err">${e.message.includes('fetch') ? "Couldn't reach Oasis. Check your connection." : 'Something went wrong. Please try again.'}</p>`
    }
  } finally {
    history.push({ role: 'assistant', content: answer.trim() })
    const shown = sources.slice(0, 3)
    if (shown.length && answer.trim()) {
      bubble.after(h('div', { class: 'sources' },
        h('span', { class: 'label' }, 'Might help'),
        shown.map((s) => s.url
          ? h('a', { class: 'source', href: s.url, target: '_blank', rel: 'noopener noreferrer' }, h('b', {}, s.title), h('span', {}, s.summary))
          : h('div', { class: 'source' }, h('b', {}, s.title), h('span', {}, s.summary)))
      ))
    }
    setBusy(false)
    scrollDown()
  }
}

function crisisCard (contacts) {
  return h('div', { class: 'crisis', role: 'alert' },
    h('h3', {}, 'You deserve support right now'),
    h('p', { class: 'soft' }, "It sounds like things might be really hard. If you're in danger or thinking about harming yourself, please reach out to someone now:"),
    h('div', { class: 'contacts' }, (contacts || []).map(contactCard))
  )
}

function setBusy (b) {
  busy = b
  $('#talk-send').hidden = b
  $('#talk-stop').hidden = !b
  $('#talk-send').disabled = b || !modelReady
}
