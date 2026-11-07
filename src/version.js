// Version info shared by server and UI. Bump API_LEVEL whenever routes change
// so the UI can detect a stale server process (e.g. an old `npm run host`
// still holding the port) and tell the user to restart it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))
export const APP_VERSION = pkg.version
export const API_LEVEL = 3
