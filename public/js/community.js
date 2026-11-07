// Community: anonymous peer-to-peer forum. Every request goes to THIS device's
// node (/api/forum/*), which syncs with other members over Hyperswarm.
import { $, h, api, timeAgo, randomAlias, settings } from './ui.js'

const TAG_LABELS = { workload: 'Workload', exams: 'Exams', 'impostor-syndrome': 'Impostor syndrome', bullying: 'Bullying', loneliness: 'Loneliness', anxiety: 'Anxiety', 'low-mood': 'Low mood', other: 'Other' }
let tags = Object.keys(TAG_LABELS)
let filter = ''
let composeTag = 'other'
let openThread = null
let active = false
let openCrisis = () => {}

const hidden = new Set(settings.get('hiddenPosts', []))
const supported = new Set(settings.get('supported', []))

export function initCommunity (store, { showCrisis }) {
  openCrisis = showCrisis
  if (!settings.get('alias')) settings.set('alias', randomAlias())
  renderAlias()
  $('#alias-new').addEventListener('click', () => { settings.set('alias', randomAlias()); renderAlias() })

  $('#compose-open').addEventListener('click', () => { $('#compose').hidden = false; $('#compose-open').hidden = true; $('#compose-body').focus() })
  $('#compose-cancel').addEventListener('click', closeCompose)
  $('#compose').addEventListener('submit', async (e) => {
    e.preventDefault()
    const title = $('#compose-title').value.trim()
    const body = $('#compose-body').value.trim()
    if (!title && !body) return
    try {
      await api('/api/forum/posts', { method: 'POST', body: JSON.stringify({ title, body, tag: composeTag, alias: settings.get('alias') }) })
      $('#compose-title').value = ''; $('#compose-body').value = ''
      showError('#compose-error', '')
      closeCompose()
      refresh()
    } catch (err) { showError('#compose-error', err.message) }
  })

  $('#thread-back').addEventListener('click', () => { openThread = null; showList() })
  $('#reply-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const body = $('#reply-body').value.trim()
    if (!body || !openThread) return
    try {
      await api(`/api/forum/posts/${openThread}/replies`, { method: 'POST', body: JSON.stringify({ body, alias: settings.get('alias') }) })
      $('#reply-body').value = ''
      showError('#reply-error', '')
      loadThread(openThread)
    } catch (err) { showError('#reply-error', err.message) }
  })

  api('/api/forum/meta').then((m) => { tags = m.tags || tags; renderTagControls() }).catch(() => renderTagControls())
  renderTagControls()
  setInterval(() => { if (active) refresh() }, 4000)
}

export function showCommunity (on) {
  active = on
  if (on) refresh()
}

function showError (sel, msg) { const el = $(sel); el.textContent = msg; el.hidden = !msg }

function renderAlias () { $('#alias').textContent = settings.get('alias') }

function closeCompose () { $('#compose').hidden = true; $('#compose-open').hidden = false }

function renderTagControls () {
  const filterEl = $('#tag-filter')
  filterEl.innerHTML = ''
  filterEl.append(chip('All', !filter, () => { filter = ''; renderTagControls(); refresh() }))
  for (const t of tags) filterEl.append(chip(TAG_LABELS[t] || t, filter === t, () => { filter = t; renderTagControls(); refresh() }))

  const composeEl = $('#compose-tags')
  composeEl.innerHTML = ''
  for (const t of tags) composeEl.append(chip(TAG_LABELS[t] || t, composeTag === t, () => { composeTag = t; renderTagControls() }))
}

function chip (label, on, onclick) { return h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), onclick }, label) }

function refresh () {
  if (openThread) return loadThread(openThread, true)
  api('/api/forum/posts' + (filter ? `?tag=${encodeURIComponent(filter)}` : ''))
    .then(({ posts, status }) => renderPosts(posts, status))
    .catch((e) => { $('#posts').innerHTML = ''; $('#posts').append(h('div', { class: 'empty' }, e.message || 'The community board is unavailable right now.')) })
}

function renderPosts (posts, status) {
  const el = $('#posts')
  const visible = posts.filter((p) => !hidden.has(p.id))
  el.innerHTML = ''
  if (!visible.length) {
    el.append(h('div', { class: 'empty' },
      status?.peers ? 'No posts here yet. You could be the first to share.' : 'No posts yet. Looking for other members of your community…'))
    return
  }
  for (const p of visible) {
    el.append(h('article', { class: 'card post', tabindex: 0, onclick: () => loadThread(p.id), onkeydown: (e) => { if (e.key === 'Enter') loadThread(p.id) } },
      h('span', { class: 'tag' }, TAG_LABELS[p.tag] || p.tag),
      p.title ? h('h3', {}, p.title) : null,
      p.body ? h('p', {}, p.body) : null,
      h('div', { class: 'meta' },
        h('span', { class: 'alias' }, p.alias),
        h('span', {}, timeAgo(p.ts)),
        h('span', {}, `💬 ${p.replies}`),
        h('span', {}, `💚 ${p.support}`))
    ))
  }
}

function showList () {
  $('#forum-thread-view').hidden = true
  $('#forum-list-view').hidden = false
  refresh()
}

async function loadThread (id, quiet = false) {
  openThread = id
  let t
  try { t = await api(`/api/forum/posts/${id}`) } catch (e) { if (!quiet) { openThread = null; $('#posts').prepend(h('div', { class: 'form-error' }, e.message)) } return }
  $('#forum-list-view').hidden = true
  $('#forum-thread-view').hidden = false
  const p = t.post
  const isSupported = supported.has(p.id)
  const el = $('#thread')
  // Preserve the reply draft while auto-refreshing.
  el.innerHTML = ''
  el.append(...[
    p.concern ? h('div', { class: 'concern' }, "If you wrote this and you're not safe right now, please reach out. You matter.", h('br'), h('button', { class: 'pill urgent', type: 'button', onclick: openCrisis }, 'See urgent support')) : null,
    h('article', { class: 'card thread-post' },
      h('span', { class: 'tag' }, TAG_LABELS[p.tag] || p.tag),
      p.title ? h('h2', { style: 'margin-top:10px' }, p.title) : null,
      p.body ? h('p', {}, p.body) : null,
      h('div', { class: 'meta' },
        h('span', { class: 'alias' }, p.alias),
        h('span', {}, timeAgo(p.ts)),
        h('button', {
          type: 'button',
          class: 'support-btn' + (isSupported ? ' sent' : ''),
          disabled: isSupported,
          onclick: async () => {
            try {
              await api(`/api/forum/posts/${p.id}/support`, { method: 'POST', body: '{}' })
              supported.add(p.id); settings.set('supported', [...supported]); loadThread(p.id, true)
            } catch (e) { showError('#reply-error', e.message) }
          }
        }, `💚 ${isSupported ? 'Support sent' : 'Send support'} · ${p.support}`),
        h('button', {
          type: 'button',
          class: 'link-btn hide-btn',
          onclick: () => { hidden.add(p.id); settings.set('hiddenPosts', [...hidden]); openThread = null; showList() }
        }, 'Hide')
      )
    ),
    h('div', { class: 'replies' },
      t.replies.length
        ? t.replies.map((r) => h('div', { class: 'reply' },
          r.concern ? h('div', { class: 'concern' }, 'This reply mentions something serious. ', h('button', { class: 'link-btn', type: 'button', onclick: openCrisis }, 'Urgent support')) : null,
          h('p', {}, r.body),
          h('div', { class: 'meta' }, h('span', { class: 'alias' }, r.alias), h('span', {}, timeAgo(r.ts)))))
        : h('div', { class: 'empty' }, 'No replies yet. A few kind words can mean a lot.'))
  ].filter(Boolean))
}
