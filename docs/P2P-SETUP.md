# Connecting devices to Oasis over P2P (no repo needed)

Only **one** computer, the **host**, needs this project. Every other device
connects to it peer-to-peer with **Holesail**: no cloning, no accounts, no port
forwarding, no cloud server.

```
 Other device                                   Host (GPU computer, runs this repo)
 ┌──────────────────────────┐   Holesail P2P   ┌──────────────────────────────┐
 │ browser → 127.0.0.1:8989 │ ═══════════════► │ Oasis on 127.0.0.1:8787      │
 │ (holesail client)        │  encrypted, no   │ AI guide · forum · resources │
 └──────────────────────────┘  server between  └──────────────────────────────┘
```

---

## Part A: on the host (once)

1. **Stop any old Oasis windows.** In every terminal still running
   `npm run host` or `npm run client`, press **Ctrl+C** (or close the window).
   An old process keeps the port and serves outdated code. Oasis now detects
   this and tells you, but it's easiest to start clean.

2. Open a terminal in the project folder and start the host:

   ```powershell
   npm run host
   ```

3. **Windows only, the first time:** if a *Windows Defender Firewall* pop-up
   appears for **Node.js**, tick **both Private and Public networks** and click
   **Allow**. If you clicked Cancel earlier, see Troubleshooting below.

4. Wait for these lines:

   ```
   P2P READY. This is your community invite …
      hs://s000xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   …
   P2P self-check ✔ this host can be found on the Holesail DHT
   model: ready
   ```

   If you see `✔`, other devices can find you. The `hs://s000…` line is the
   **invite**. Copy it, and share it only with people who should have access.

5. Check that it works on the host itself: open **http://127.0.0.1:8787**.

The invite stays the same every time you start the host. It's stored in
`data/holesail-host.key`; delete that file to create a new one, which also
starts a fresh forum.

---

## Part B: on another laptop or PC (Windows, macOS, Linux)

1. Install **Node.js LTS** from <https://nodejs.org> (default options).
2. Open a terminal (Windows: *PowerShell*; macOS: *Terminal*).
3. Paste this, replacing the invite with yours:

   ```bash
   npx holesail@2 hs://s000xxxxxxxx… --port 8989
   ```

   The first time, it asks to install `holesail`; type `y`. When you see

   ```
   Holesail TCP Client Started ⛵️
   Access application on http://127.0.0.1:8989/
   ```

   the tunnel is open.

4. Open **http://127.0.0.1:8989** in a browser. That's Oasis, running on the
   host's GPU.
5. Keep the terminal open while you use it. Press **Ctrl+C** to disconnect.

> Use `127.0.0.1`, not `localhost`. Some systems resolve `localhost` to IPv6,
> where the tunnel isn't listening.

**Optional:** install it permanently so you can skip `npx` next time:
`npm i -g holesail`, then `holesail hs://s000… --port 8989`.

---

## Part C: on a phone

**iPhone:** install **Holesail Go** from the App Store. Add a connection by
scanning the QR code printed in the host's terminal, or paste the invite.
Connect, then open the local address the app shows (e.g.
`http://127.0.0.1:8989`) in Safari. Tap **Share → Add to Home Screen** for an
app-like icon.

**Android:** there's no official Holesail app yet. Options:
- the community app **holesail-gui** (<https://codeberg.org/Chethan62/holesail-gui>), or
- **Termux** (from F-Droid): `pkg install nodejs`, then run the same
  `npx holesail@2 hs://s000… --port 8989`, and open `http://127.0.0.1:8989`
  in Chrome.

---

## Part D (optional): a full Oasis client

If a device *does* have the project, `npm run client -- hs://s000…` gives it
its **own copy of the community forum** (synced over Hyperswarm). Reading and
posting then keep working while the host is offline. Chat still uses the
host's GPU through Holesail. Open **http://127.0.0.1:8788**.

---

## Checking it works

- The banner at the top must **not** say "Oasis needs a restart".
- Tap the **sliders icon** (top right) → *System details*:
  - *Reached via*: **Holesail P2P tunnel** (on another device)
  - *DHT self-check*: **✔ findable by other devices**
  - *Open connections*: goes up by one for each connected device
- Post something in **Community** on one device. It shows up on the host (and
  on everyone else) within a couple of seconds.

From the host you can also run the automated check against any device's port,
for example after starting `holesail … --port 8989` on the same machine:
`npm run test:e2e -- http://127.0.0.1:8787 http://127.0.0.1:8989`

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Banner: **"Oasis needs a restart"**, or "not found" errors when posting | An old `npm run host` is still running. Close **all** Oasis terminals and start `npm run host` again. If you can't find the window, end the `node.exe` processes in Task Manager. |
| Host prints **`✖ Port 8787 is already in use`** | Same cause as above, or another app uses the port. Set `$env:GUH_HTTP_PORT=8790` before `npm run host`. |
| Host prints **`P2P self-check ✖`** | The host can't reach the DHT. Check its internet connection. On Windows: *Windows Security → Firewall & network protection → Allow an app through firewall → Node.js*, and tick **Private** and **Public**. |
| Other device: tunnel starts but the page won't load | Check the invite is complete (`hs://s000` + 64 characters) and the host is running. Restart the `holesail` command. |
| Works at home, fails on campus Wi-Fi | Some networks block the UDP traffic that P2P hole-punching needs. Try a phone hotspot on one side to confirm, and use that for the demo. |
| `npx` asks "Ok to proceed?" | Type `y`. It downloads Holesail once. |
| "Can't reach the Oasis host right now" | The host is off or asleep. The Community tab still works on full Oasis clients. |
