import { spawn } from 'node:child_process'

const processes = [
  spawn('node', ['server/asset-portal.mjs'], {
    shell: true,
    stdio: 'inherit',
  }),
  spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0'], {
    shell: true,
    stdio: 'inherit',
  }),
]

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

processes.forEach((child) => {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      stopAll()
      process.exit(code)
    }
  })
})
