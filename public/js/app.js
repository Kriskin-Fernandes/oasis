// App shell: tabs, sheets, status polling. Works identically on the host
// (http://127.0.0.1:8787) and on a client node (http://127.0.0.1:8788).
import { $, $$, api } from './ui.js'
import { initTalk } from './talk.js'
import { initCommunity, showCommunity } from './community.js'
import { initResources, showResources, renderCrisis } from './resources.js'
import { renderDebug } from './debug.js'

// Must match API_LEVEL in src/version.js. A mismatch means the server process
// was started from older code than the page that's loaded.
const EXPECTED_API = 3

// Tiny event store shared by views.
const listeners = {}
const store = {
  status: null,
  lastChat: null,
  on (ev, fn) { (listeners[ev] ||= []).push(fn) },
  emit (ev, data) { for (const fn of listeners[ev] || []) fn(data) }
}

// ── Tabs ────────────────────────────────────────────────────────────────────
function show (view) {
  for (const b of $$('.tabs button')) b.classList.toggle('active', b.dataset.view === view)
  for (const v of $$('.view')) v.classList.toggle('active', v.id === `view-${view}`)
  showCommunity(view === 'community')
  showResources(view === 'resources')
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`)
  window.scrollTo({ top: 0 })
}
const VIEWS = ['talk', 'community', 'resources']
const viewFromHash = () => (VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'talk')
window.addEventListener('hashchange', () => show(viewFromHash()))
for (const b of $$('.tabs button')) b.addEventListener('click', () => show(b.dataset.view))

// ── Sheets ──────────────────────────────────────────────────────────────────
function openSheet (id) { $(id).hidden = false; if (id === '#debug-sheet' && store.status) renderDebug(store.status, store) }
for (const sheet of $$('.sheet-backdrop')) {
  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-close]')) sheet.hidden = true })
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') for (const s of $$('.sheet-backdrop')) s.hidden = true })
const showCrisis = () => openSheet('#crisis-sheet')
$('#open-crisis').addEventListener('click', showCrisis)
$('#open-debug').addEventListener('click', () => openSheet('#debug-sheet'))

// ── Status ──────────────────────────────────────────────────────────────────
let appliedBranding = false
async function poll () {
  try {
    const s = await api('/api/status')
    store.status = s
    if (!appliedBranding && s.app) {
      appliedBranding = true
      document.title = s.app.name
      $('#app-name').textContent = s.app.name
      $('#welcome-title').textContent = `Hi, I'm ${s.app.name}.`
      $('#uni-name').textContent = s.app.university
    }
    const m = s.model || {}
    const unreachable = s.node?.role === 'client' && !s.node.hostReachable
    $('#status-dot').className = 'status-dot ' + (unreachable || m.state === 'error' ? 'err' : m.state === 'ready' ? 'ok' : 'busy')
    renderBanner(s)
    store.emit('status', s)
    renderDebug(s, store)
  } catch {
    $('#status-dot').className = 'status-dot err'
  }
}

function renderBanner (s) {
  const b = $('#banner')
  let html = ''
  if (s.api !== EXPECTED_API) {
    html = "<b>Oasis needs a restart.</b> The server running on this computer is an older version than this page. Go to the terminal running it, press <code>Ctrl+C</code>, run <code>npm run host</code> again, then refresh."
  } else if (s.node?.role === 'client' && s.hostApi && s.hostApi !== EXPECTED_API) {
    html = '<b>The host is running a different version of Oasis.</b> Ask whoever runs the host to update and restart it.'
  }
  b.innerHTML = html
  b.hidden = !html
}

// Crisis contacts are served locally on every node, so they work even offline.
api('/api/crisis').then((c) => renderCrisis(c, [$('#crisis-contacts'), $('#crisis-inline')])).catch(() => {})

initTalk(store)
initCommunity(store, { showCrisis })
initResources()
show(viewFromHash())
poll()
setInterval(poll, 3000)
