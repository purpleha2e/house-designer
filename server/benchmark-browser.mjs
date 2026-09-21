import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const urls = args.filter(arg => arg !== '--dry-run')
if (urls.length > 1) {
  throw new Error('Usage: npm run benchmark:browser -- [http://localhost:4173] [--dry-run]')
}
const url = new URL(urls[0] ?? 'http://localhost:4173')
if (!['http:', 'https:'].includes(url.protocol)) {
  throw new Error('The designer URL must use http:// or https://.')
}

const windowsRoots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
  .filter(Boolean)
const candidates = [
  process.env.CHROME_PATH,
  ...windowsRoots.map(root => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
  ...windowsRoots.map(root => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)
const executable = candidates.find(candidate => existsSync(candidate))
if (!executable) throw new Error('Chrome or Edge was not found. Set CHROME_PATH to the browser executable.')

// A dedicated profile forces a separate browser process, so the flags take
// effect even when the user's normal browser is already running.
const profileDirectory = dryRun
  ? join(tmpdir(), 'house-designer-benchmark-browser-<new>')
  : mkdtempSync(join(tmpdir(), 'house-designer-benchmark-browser-'))
const browserArgs = [
  `--user-data-dir=${profileDirectory}`,
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',
  '--no-first-run',
  '--no-default-browser-check',
  '--new-window',
  url.href,
]

async function designerIsAvailable() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
    await response.body?.cancel()
    return response.ok
  } catch {
    return false
  }
}

const wait = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds))

async function waitForDesigner(timeoutMilliseconds = 30_000) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    if (await designerIsAvailable()) return true
    await wait(200)
  }
  return false
}

if (dryRun) {
  console.log(JSON.stringify({ executable, args: browserArgs }, null, 2))
} else {
  let preview = null
  let browser = null
  if (!(await designerIsAvailable())) {
    const isDefaultLocalPreview =
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.port === '4173'
    if (!isDefaultLocalPreview) {
      console.error(`Cannot reach the designer at ${url.href}`)
      console.error('Start the server for that address, then rerun this command.')
      process.exit(1)
    }

    console.log('No designer server is running. Starting a fresh preview...')
    preview = spawn(process.execPath, ['server/preview-with-portal.mjs'], {
      stdio: 'inherit',
    })
    if (!(await waitForDesigner()) || preview.exitCode !== null) {
      preview.kill()
      console.error(`The designer did not become ready at ${url.href}.`)
      process.exit(1)
    }
  }

  const stopPreview = () => {
    if (preview && !preview.killed) preview.kill()
  }
  const removeProfile = () => {
    const absoluteProfile = resolve(profileDirectory)
    const temporaryRoot = resolve(tmpdir())
    if (
      !absoluteProfile.startsWith(`${temporaryRoot}${sep}`) ||
      !basename(absoluteProfile).startsWith('house-designer-benchmark-browser-')
    ) return
    try {
      rmSync(absoluteProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      console.warn(`Could not remove temporary benchmark profile: ${profileDirectory}`)
    }
  }
  const stopBrowser = () => {
    if (browser && !browser.killed) browser.kill()
  }
  process.once('SIGINT', () => {
    stopBrowser()
    stopPreview()
    removeProfile()
    process.exit(0)
  })
  process.once('SIGTERM', () => {
    stopBrowser()
    stopPreview()
    removeProfile()
    process.exit(0)
  })

  browser = spawn(executable, browserArgs, {
    stdio: 'ignore',
  })
  browser.once('error', error => {
    stopPreview()
    removeProfile()
    console.error(`Unable to launch benchmark browser: ${error.message}`)
    process.exitCode = 1
  })
  browser.once('spawn', () => {
    console.log(`Opened ${url.href} with browser frame limiting and GPU VSync disabled.`)
    console.log('Keep this terminal open. Close the benchmark browser or press Ctrl+C when finished.')
  })
  browser.once('exit', () => {
    stopPreview()
    removeProfile()
  })
}
