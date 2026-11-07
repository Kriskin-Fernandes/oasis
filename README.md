# Oasis: a private wellbeing guide and community for students

**Oasis** is a calm, phone-friendly place for students who are struggling with
workload, exams, impostor syndrome, bullying, loneliness and more.

- **Talk:** an AI guide that listens and suggests small next steps. It also
  **signposts** students to the right university services and people: the
  counselling service, the student council (SRC), student ambassadors, advisers.
  The guide runs **100% locally** with QVAC (Qwen3.5-9B) on hardware the
  community owns.
- **Community:** an **anonymous forum** that syncs **peer-to-peer** over
  Hyperswarm. There's no server, no accounts and no names, and it keeps working
  when the AI host is offline.
- **Support:** searchable university resources imported from **Firecrawl**
  JSON, plus urgent-help contacts that are always one tap away.
- **Holesail** tunnels each student's device to the GPU host, peer-to-peer and
  end-to-end encrypted. No cloud APIs, relays or port forwarding.

Built for the *Be Your Own Datacenter* challenge (QVAC × Pears). See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data and inference paths.

```
 STUDENT DEVICE (client node)                           HOST (community GPU machine)
 ┌──────────────────────────────────┐                   ┌──────────────────────────────────────┐
 │ browser → http://127.0.0.1:8788  │                   │ http://127.0.0.1:8787 (loopback)     │
 │   ├ /api/forum/* → local forum ◄─┼── Hyperswarm ────►│ forum node ◄──► other students' nodes│
 │   └ /api/chat, … ─► holesail ────┼── Holesail P2P ──►│ guide → QVAC → Qwen3.5-9B (GPU)      │
 └──────────────────────────────────┘   (encrypted)     │       ↑ resources from ./firecrawl   │
                                                        └──────────────────────────────────────┘
```

## Requirements

| | Host (runs the AI) | Client (a student's device) |
|---|---|---|
| Node.js | ≥ 22.17 | ≥ 22.17 |
| OS | Windows 10+ x64, Linux (Ubuntu 22+), or macOS 14+ arm64 | any OS that runs Node |
| GPU | Vulkan ≥ 1.4 driver recommended; falls back to CPU | none |
| Disk / RAM | ~6 GB for the model, 16 GB RAM recommended | none |

## Setup

```bash
npm install
npm run prefetch     # optional: downloads Qwen3.5-9B (~5.7 GB) and asks it one question
```

## Run the demo

> **Upgrading from an earlier version?** Close every terminal still running
> `npm run host` or `npm run client` first. An old process keeps the port and
> serves outdated code (that was the cause of "not found" errors). Oasis now
> detects this and tells you.

### 1. Host (the machine with the GPU)

```powershell
$env:GUH_UNIVERSITY="The University of Manchester"   # optional: your university's name
npm run host
```

The host prints the **community invite** (an `hs://s000…` connection string),
a QR code, ready-to-paste commands for other devices, and a **P2P
self-check ✔** once it is findable on the network. Open
**http://127.0.0.1:8787**.

The invite is a secret. It's the key for both the AI tunnel and the forum. It's
saved in `data/holesail-host.key`, so it stays the same across restarts.

### 2. Other devices: no repo needed

**→ Step-by-step guide: [docs/P2P-SETUP.md](docs/P2P-SETUP.md)**

Short version, on any laptop with Node.js:

```bash
npx holesail@2 hs://s000<invite> --port 8989
```

then open **http://127.0.0.1:8989**. That's the full Oasis app (Talk,
Community, Support), served by the host over an encrypted P2P tunnel.
iPhone: **Holesail Go** app → scan the host's QR code → open the address it
shows in Safari.

**Optional full client** (needs the repo): `npm run client -- hs://s000<invite>`
gives a device its own forum replica that keeps working while the host is
offline (UI on http://127.0.0.1:8788).

### What to show judges
1. **Talk:** tap *"I'm overwhelmed with deadlines"*. The reply streams from the
   local GPU and names specific services, followed by **Might help** cards.
2. **Crisis path:** type something like *"I don't want to be alive anymore"*.
   Urgent contacts appear **before** the model replies, and the reply repeats
   them.
3. **Community:** post anonymously from a second device. It appears on the
   host, and replies and 💚 support flow back.
4. **System details** (the sliders icon at top right): live proof of local
   inference (model, tok/s, GPU, VRAM), Holesail tunnel peers, forum peers and
   sync counts, and the knowledge-base files.
5. On a full client (`npm run client`), stop the host. Community keeps working,
   and Talk explains that the host is unreachable.

## Adding university resources (Firecrawl)

Put Firecrawl JSON output in [`firecrawl/`](firecrawl/README.md). The host
re-indexes **live**. The loader also repairs scraped URLs where dots became
slashes (`https://www/mind/org/uk/…` → `https://www.mind.org.uk/…`), drops
"page not found" scrapes, and strips navigation and cookie-banner noise. Scrape, crawl and extract formats are all supported,
including structured people lists (`name`, `role`, `email`…), which is ideal
for SRC members and ambassadors. Check what was loaded with `npm run test:kb`.

While `firecrawl/` has no JSON, the app uses **clearly fictional sample data**
for "Example University" (`examples/firecrawl-sample/`) so the demo works. The
Support tab says so.

Urgent-help contacts live in `config/crisis-contacts.json`. The defaults are UK
national services (999, Samaritans 116 123, Shout 85258, NHS 111). Add campus
security or your university's out-of-hours line there.

## Tests

```bash
npm run test:p2p      # Holesail tunnel through the real DHT (no model)
npm run test:forum    # two forum nodes sync a post and a reply over Hyperswarm (no model)
npm run test:kb       # which resources the guide retrieves for sample questions
npm run test:e2e      # full check against a running host (:8787) + client (:8788)
```

`test:e2e` covers 15 checks: the tunnel, the model, signposting, the crisis
path, forum sync in both directions, resources and the UI. It posts one test
message to the forum.

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `GUH_APP_NAME` | `Oasis` | App name shown in the UI and used by the guide |
| `GUH_UNIVERSITY` | `your university` | University name used by the guide |
| `GUH_FIRECRAWL_DIR` | `./firecrawl` | Where resource JSON is read from |
| `GUH_CRISIS_FILE` | `config/crisis-contacts.json` | Urgent-help contacts |
| `QVAC_MODEL_FILE` | `Qwen3.5-9B-Q4_K_M.gguf` | File from the unsloth repo (`…Q3_K_M.gguf` for GPUs with ≤6 GB VRAM) |
| `QVAC_MODEL_SRC` | HF URL | Any GGUF: an HTTPS URL, a path, or `pear://…` |
| `QVAC_CTX_SIZE` | `8192` | Context window |
| `QVAC_GPU_LAYERS` / `QVAC_DEVICE` | auto / `gpu` | Pin GPU layers, or force `cpu` |
| `GUH_HTTP_PORT` | `8787` | Host UI port |
| `GUH_CLIENT_PORT` / `GUH_TUNNEL_PORT` | `8788` / `8789` | Client UI port and internal tunnel port |
| `GUH_DATA_DIR` | `./data` | Key and forum storage (use separate dirs to run several nodes) |
| `GUH_P2P` | `on` | `off` = host without Holesail |

PowerShell: `$env:GUH_UNIVERSITY="University of Glasgow"; npm run host`

## Privacy and safety

- Conversations are **never stored**. They live only in the browser tab, and
  the host logs message counts, never content.
- Forum posts carry no device or user identity: a random alias, a timestamp
  rounded to the minute, and a content hash. Peers in the swarm can see each
  other's IP addresses, as with any P2P network.
- The guide is told it is **not a therapist**, to keep replies short, and to
  use only contact details that appear in your resources, never invented ones.
- Risk keywords (in chat or forum posts) show urgent-help contacts right away.
  This is a safety net, not a clinical assessment.
- Moderation in this base version: students can **hide** posts on their own
  device, and each node rate-limits posting. Shared moderation is on the
  roadmap (see the architecture doc).

## Troubleshooting

- **Slow replies:** check *System details → Last reply* for `on GPU`. Only run
  **one** host per GPU, because two copies of the model split VRAM and drop
  speed from about 15 to about 4 tok/s. On GPUs with ≤6 GB, try
  `QVAC_MODEL_FILE=Qwen3.5-9B-Q3_K_M.gguf`.
- **"Deep thinking"** (in System details) turns on Qwen's reasoning. Replies
  get more considered but are much slower.
- **"Oasis needs a restart" banner, or "not found" when posting:** an old
  `npm run host` is still running. Close all Oasis terminals (or end
  `node.exe` in Task Manager) and start it again.
- **P2P not connecting:** see the troubleshooting table in
  [docs/P2P-SETUP.md](docs/P2P-SETUP.md). The usual causes are Windows Firewall
  blocking Node.js, an incomplete invite, or campus Wi-Fi blocking UDP (test
  with a phone hotspot).
- **Port in use:** the host or client tells you what is holding it. Set
  `GUH_HTTP_PORT` / `GUH_CLIENT_PORT` / `GUH_TUNNEL_PORT` to use another.

## Project layout

```
src/
  host.js, client.js         entry points (host = AI + forum + tunnel; client = forum + tunnel + UI)
  config.js                  every tunable, env-overridable
  inference/qvac-engine.js   QVAC SDK: model lifecycle, streaming, FIFO queue
  guide/guide.js             wellbeing system prompt, retrieval, crisis-first ordering
  guide/safety.js            risk screen + crisis contacts
  knowledge/                 Firecrawl loader, chunking, BM25 search, live re-index
  forum/                     content-addressed messages + Hyperswarm gossip node
  p2p/tunnel.js              Holesail host/client, persistent community key
  server/                    tiny router + proxy, guide routes (host), forum routes (all nodes)
public/                      dependency-free, mobile-first UI (js/talk, community, resources, debug)
config/crisis-contacts.json  urgent-help contacts
examples/firecrawl-sample/   fictional demo resources
firecrawl/                   ← your Firecrawl JSON goes here
scripts/                     prefetch, smoke tests, end-to-end test
```
