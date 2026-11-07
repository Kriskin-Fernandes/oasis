# Architecture

## Goals

1. **Local inference only.** Every AI token is produced by QVAC on hardware the
   community owns.
2. **No middlemen.** Students reach the AI host over Holesail, and the
   community forum replicates directly between peers over Hyperswarm. There is
   no central server or relay.
3. **Safety first.** Urgent-help contacts reach the student before any model
   output whenever risk language appears, and they're served locally on every
   node.

## Nodes

| | Host node (`npm run host`) | Client node (`npm run client -- hs://…`) |
|---|---|---|
| QVAC + Qwen3.5-4B | ✔ | none |
| Knowledge base (Firecrawl) | ✔ (watched, live re-index) | none (proxied to host) |
| Forum node (Hyperswarm) | ✔ | ✔ its own full replica |
| Holesail | server: publishes `127.0.0.1:8787` | client: host → `127.0.0.1:8789` |
| UI | `127.0.0.1:8787` | `127.0.0.1:8788` |
| Crisis contacts | ✔ local | ✔ local (works when the host is offline) |

Both bind to **loopback only**. Remote access to the host is only possible
through the Holesail tunnel.

### Plain Holesail devices (no repo)

A device can also skip running Oasis entirely: `holesail hs://s000… --port 8989`
(CLI, or the Holesail Go app) tunnels the browser straight to the host. The host
serves the complete app, using its own forum node, so nothing else is needed.
The host marks these requests as `via: p2p-tunnel` because the browser's Host
header carries the tunnel port, not 8787.

### Stale-process protection

`src/version.js` defines `API_LEVEL`. `/api/health` and `/api/status` report it,
and the UI compares it with its own `EXPECTED_API`. A mismatch shows a "needs a
restart" banner. At startup, `listenOrExplain()` probes whatever holds the port
and prints a plain-language fix instead of a stack trace. The host also checks
that it's findable on the DHT (`Holesail.lookup`) and logs ✔/✖.

## One secret, two P2P channels

The host generates a 256-bit secret (`data/holesail-host.key`). The invite is
`hs://s000<secret>`.

- **Holesail (secure mode):** the DHT keypair is derived from the secret, and
  the server's firewall only accepts peers holding the same keypair.
- **Forum topic:** `sha256("guh-forum-v1:" + secret)`. Only the hash is
  announced on the DHT, so the topic reveals nothing about the secret.

So "having the invite" means "being a member of this community": you can use
its AI and read and write its board.

## Talk: data and inference path

```
browser (client) ── POST /api/chat {messages, think}
  → client node proxy (adds x-guh-via: p2p-tunnel)
  → holesail client :8789 ══ UDX/UDP, Noise-encrypted, hole-punched ══ holesail server
  → host HTTP 127.0.0.1:8787
  → Guide.respond()
       1. detectRisk(last 3 user turns) → emit {type:'crisis', contacts}  (before any model work)
       2. KnowledgeBase.retrieve(query)  → BM25 over Firecrawl chunks   → emit {type:'sources'}
       3. build system prompt: tone rules + UNIVERSITY RESOURCES + CRISIS CONTACTS
       4. QvacEngine.chat() — FIFO queue → @qvac/sdk completion()
            generationParams.reasoning_budget = 0 (fast) | -1 ("deep thinking")
  → SSE events stream back the same way: content deltas, stats (tok/s, device)
```

Conversations are stateless on the server: the browser sends the history each
time, and nothing is persisted or logged.

## Community: forum replication

```
ForumNode (every node)
  storage : data/forum-<role>.jsonl   append-only, one message per line
  message : { v, id, type: post|reply|support, parent, title, body, tag, alias, ts, nonce }
            id = sha256(content)  → tamper-evident, deduplicates for free
            ts rounded to the minute; alias = random name chosen in the browser
  swarm   : Hyperswarm.join(topic, {client, server})
  protocol (newline-delimited JSON over each Noise-encrypted connection):
     on connect → {t:'have', ids}           peer replies with what we're missing
     new local  → {t:'msgs', msgs:[m]}      flooded to all peers
     on 'msgs'  → validate → store new → re-flood new ones (except to sender)
  discovery retry: re-queries the DHT every 5 s while alone (first 2 min), then 30 s
```

Every node holds a full replica, so the board survives any single node,
including the host, going offline. Gossip converges because messages are
immutable and content-addressed.

Measured on one laptop (host and client as separate processes): a post
replicated client → host in about 0.5 s, and a reply plus support came back
host → client in about 0.5 s.

## Knowledge base

- `firecrawl-loader.js` normalises scrape, crawl and extract output, and
  hand-written JSON. It skips envelope fields (`success`, `_note`, …), turns
  structured records (people, services) into "key: value" documents, and
  strips scraped-page noise.
- `knowledge-base.js` chunks documents (~900 characters on paragraph and
  heading boundaries), builds two BM25 indexes (chunks for the prompt,
  documents for the Support tab), and watches the folder.
- `search.js` is a dependency-free BM25 with light stemming and
  wellbeing-specific query expansion (e.g. *overwhelmed → workload, deadline,
  extension*).
- If `firecrawl/` has no JSON, the fictional sample in
  `examples/firecrawl-sample/` is used, and `usingSample` is shown in the UI.

## Security and privacy notes

- The host API isn't reachable from the network, only through the tunnel.
- `via` detection (the `x-guh-via` header or Host-header port) is used for
  display only, never for authorization.
- Forum messages contain no identity. Hyperswarm peers can see each other's IP
  addresses, which is inherent to direct P2P.
- Anyone holding the invite can post. Each node applies size and timestamp
  validation and per-node rate limits; anything more needs moderation (below).

## Roadmap / extension points

| Feature | Where |
|---|---|
| Semantic search with QVAC embeddings (`embed`/`ragIngest`/`ragSearch`) | swap `Bm25Index` in `knowledge-base.js`; same `retrieve()` interface |
| Shared moderation (moderator keys sign `hide` messages; nodes honour them) | new message type in `forum/message.js` + filter in `ForumNode.list()` |
| Multi-writer log with Autobase/Hypercore instead of JSONL gossip | replace `ForumNode` internals; the HTTP routes stay the same |
| AI "gentle reply" suggestions for forum posts, or flagging posts that need a human | call `Guide`/`QvacEngine` from forum routes on the host |
| Voice input/output (QVAC Whisper/Parakeet + TTS) | new `QvacEngine` methods + `/api/voice` |
| Ship the client as a Pear app (`pear run pear://…`) | `public/` + `client.js` are already dependency-light |
| Distribute model files P2P | `QVAC_MODEL_SRC=pear://<hyperdrive-key>/model.gguf` |
| Multi-host pool | the client keeps several invites and picks the least busy host (`/api/status → model.pending`) |
