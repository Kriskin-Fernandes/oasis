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

### 1. Host (the machine with the GPU)

```bash
npm run host
```

The host prints the **community invite**: an `hs://s000…` connection string
and a QR code. Open **http://127.0.0.1:8787**.

The invite is a secret. It's the key for both the AI tunnel and the forum. It's
saved in `data/holesail-host.key`, so it stays the same across restarts. Delete
that file to rotate it; this also starts a fresh forum.

### 2. Client (a student's laptop, any network)

```bash
npm install
npm run client -- hs://s000<invite>
```

The browser opens **http://127.0.0.1:8788**. The student sees the same app. Chat
goes to the host's GPU over Holesail, and the forum syncs directly between
peers.

**One-machine demo:** run `npm run host` and `npm run client -- hs://…` in two
terminals, then open `:8787` and `:8788` side by side. Post in Community on one
and it appears on the other within about a second.

**Phone:** open the client URL in the phone's browser, or scan the host's QR
code with the Holesail mobile app and open the port it shows. The UI is
designed for phones first, and you can add it to the home screen.

### What to show judges
1. **Talk:** tap *"I'm overwhelmed with deadlines"*. The reply streams from the
   local GPU and names specific services, followed by **Might help** cards.
2. **Crisis path:** type something like *"I don't want to be alive anymore"*.
   Urgent contacts appear **before** the model replies, and the reply repeats
   them.
3. **Community:** post anonymously from the client. It appears on the host, and
   replies and 💚 support flow back.
4. **System details** (the sliders icon at top right): live proof of local
   inference (model, tok/s, GPU, VRAM), Holesail tunnel peers, forum peers and
   sync counts, and the knowledge-base files.
5. Stop the host. The client's Community tab keeps working, and Talk explains
   that the host is unreachable.

## Adding university resources (Firecrawl)

Put Firecrawl JSON output in [`firecrawl/`](firecrawl/README.md). The host
re-indexes **live**. Scrape, crawl and extract formats are all supported,
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
- **The client can't reach the host:** check that the host is running and that
  you copied the whole invite. Some campus networks block UDP hole-punching;
  a phone hotspot confirms whether that's the cause.
- **Port in use:** set `GUH_HTTP_PORT` / `GUH_CLIENT_PORT` / `GUH_TUNNEL_PORT`.

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
