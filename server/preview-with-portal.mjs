import { spawn } from 'node:child_process'

const portalPort = Number(process.env.ASSET_PORTAL_PORT ?? 5174)
const portalHealthUrl = `http://localhost:${portalPort}/api/portal/health`
const workspacePort = Number(process.env.WORKSPACE_PORT ?? 5175)
const workspaceHealthUrl = `http://127.0.0.1:${workspacePort}/api/workspace/health`

async function isWorkspaceRunning() {
  try { return (await fetch(workspaceHealthUrl)).ok } catch { return false }
}

async function isPortalRunning() {
  try {
    const response = await fetch(portalHealthUrl)

    return response.ok
  } catch {
    return false
  }
}

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitForPortal(timeoutMilliseconds = 15_000) {
  const deadline = Date.now() + timeoutMilliseconds

  while (Date.now() < deadline) {
    if (await isPortalRunning()) {
      return true
    }

    await wait(100)
  }

  return false
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

  if (!(await waitForPortal())) {
    console.error(
      `Asset portal did not become ready at ${portalHealthUrl} within 15 seconds.`,
    )
    stopAll()
    process.exit(1)
  }
}

if (!(await isWorkspaceRunning())) {
  spawnProcess('node', ['--experimental-strip-types', 'server/workspace-service.ts'])
  const deadline = Date.now() + 15_000
  while (!(await isWorkspaceRunning()) && Date.now() < deadline) await wait(100)
  if (!(await isWorkspaceRunning())) {
    console.error(`Workspace service did not become ready at ${workspaceHealthUrl}.`)
    stopAll(); process.exit(1)
  }
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
