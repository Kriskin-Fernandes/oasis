// Support: browse/search the university resources the guide signposts to,
// plus urgent contacts that are always visible.
import { $, h, api, contactCard } from './ui.js'

let timer = null

export function initResources () {
  $('#res-search').addEventListener('input', (e) => {
    clearTimeout(timer)
    timer = setTimeout(() => load(e.target.value.trim()), 250)
  })
}

export function showResources (on) { if (on) load($('#res-search').value.trim()) }

export function renderCrisis (crisis, targets) {
  for (const el of targets) {
    el.innerHTML = ''
    for (const c of crisis.contacts || []) el.append(contactCard(c))
  }
}

async function load (q) {
  const el = $('#resources')
  try {
    const { resources, knowledge } = await api('/api/resources' + (q ? `?q=${encodeURIComponent(q)}` : ''))
    const note = $('#res-note')
    note.hidden = !knowledge?.usingSample
    note.textContent = 'Showing sample resources for demo purposes. Real university resources appear here once they are added.'
    el.innerHTML = ''
    if (!resources.length) { el.append(h('div', { class: 'empty' }, q ? 'Nothing matched. Try another word, or ask Oasis in Talk.' : 'No resources have been added yet.')); return }
    for (const r of resources) {
      el.append(h('article', { class: 'card resource' },
        h('h3', {}, r.title),
        h('p', {}, r.summary),
        r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, 'Visit ↗') : null))
    }
  } catch (e) {
    el.innerHTML = ''
    el.append(h('div', { class: 'empty' }, e.message || 'Resources are unavailable right now.'))
  }
}
