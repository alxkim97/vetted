// Runs Electron with ELECTRON_RUN_AS_NODE removed — VS Code's terminal sets
// it, which makes electron.exe behave like plain Node.
import { spawnSync } from 'node:child_process'
import electron from 'electron'
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const r = spawnSync(electron, process.argv.slice(2), { stdio: 'inherit', env })
process.exit(r.status ?? 1)
