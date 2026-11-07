// Thin wrapper around Holesail (HyperDHT / Holepunch stack).
//
// Host side:  exposes a local TCP port on the DHT behind a secret hs:// key.
// Client side: dials that key peer-to-peer (UDP hole-punching, Noise-encrypted)
//              and re-exposes the remote port on a local port.
// No relay server, no port forwarding, no public IP needed.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import Holesail from 'holesail'

/** Load the persisted host key, or create one (64 hex chars = 256-bit secret). */
export function loadOrCreateHostKey (keyFile) {
  try {
    const k = fs.readFileSync(keyFile, 'utf8').trim()
    if (k.length >= 32) return k
  } catch {}
  const key = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(path.dirname(keyFile), { recursive: true })
  fs.writeFileSync(keyFile, key, { mode: 0o600 })
  return key
}

export async function startHostTunnel ({ port, host = '127.0.0.1', key }) {
  // secure: true → only peers that know the full key can even find/connect.
  const hs = new Holesail({ server: true, secure: true, key, port, host })
  await hs.ready()
  return {
    url: hs.info.url,
    info: () => hs.info,
    /** Number of distinct remote peers currently connected. */
    peers: () => {
      const m = hs.dht?.activeConnections
      return m ? [...m.values()].reduce((a, b) => a + b, 0) : 0
    },
    peerIds: () => [...(hs.dht?.activeConnections?.keys() || [])].map((k) => k.slice(0, 8)),
    close: () => hs.close()
  }
}

export async function startClientTunnel ({ url, port, host = '127.0.0.1' }) {
  const hs = new Holesail({ client: true, key: url, port, host })
  await hs.ready()
  return { info: () => hs.info, close: () => hs.close() }
}

/** Ask the DHT whether a host key is online (no connection made). */
export async function lookupHost (url) {
  try { return await Holesail.lookup(url) } catch (e) { return { error: e.message } }
}

/** The community secret embedded in an hs:// URL (secure mode: hs://s000<secret>). */
export function secretFromUrl (url) {
  const { key, secure } = Holesail.urlParser(url)
  if (!secure) throw new Error('Expected a secure connection string (hs://s000…)')
  return key
}
