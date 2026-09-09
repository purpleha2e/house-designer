import { spawn } from 'node:child_process'

const portalPort = Number(process.env.ASSET_PORTAL_PORT ?? 5174)
const portalHealthUrl = `http://localhost:${portalPort}/api/portal/health`

async function isPortalRunning() {
  try {
    const response = await fetch(portalHealthUrl)

    return response.ok
  } catch {
    return false
  }
}

const processes = []

function spawnProcess(command, args) {
  const child = spawn(command, args, {
    shell: true,
    stdio: 'inherit',
  })

  processes.push(child)

  return child
}

function stopAll() {
  for (const child of processes) {
    if (!child.killed) {
      child.kill()
    }
  }
}

process.on('SIGINT', () => {
  stopAll()
  process.exit(0)
})

process.on('SIGTERM', () => {
  stopAll()
  process.exit(0)
})

if (!(await isPortalRunning())) {
  spawnProcess('node', ['server/asset-portal.mjs'])
}

spawnProcess('npm', ['run', 'preview:vite', '--', '--host', '0.0.0.0'])

processes.forEach((child) => {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      stopAll()
      process.exit(code)
    }
  })
})
