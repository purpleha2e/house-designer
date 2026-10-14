import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const browsers = new Map()
const profiles = new Set()
const profileRoot = resolve(fileURLToPath(new URL('../../node_modules/.cache/browser-test-profiles/', import.meta.url)))
const cleanupScript = fileURLToPath(import.meta.url)

function validProfile(profile) {
  return dirname(profile).toLowerCase() === profileRoot.toLowerCase() &&
    /^[a-zA-Z0-9_-]+-[a-zA-Z0-9]{6}$/.test(basename(profile)) &&
    (!existsSync(profile) || (lstatSync(profile).isDirectory() && !lstatSync(profile).isSymbolicLink()))
}

export function createBrowserTestProfile(prefix) {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*-$/.test(prefix)) throw Error('Invalid browser test profile prefix')
  mkdirSync(profileRoot, { recursive: true })
  const profile = mkdtempSync(join(profileRoot, prefix))
  profiles.add(profile)
  return profile
}

/** These tests own an isolated Chrome profile. Release both the process and its
 * cache on success, assertion failure, explicit process.exit(), or interruption. */
export function spawnBrowserTest(command, args, options) {
  const profileArgument = args.find(argument => argument.startsWith('--user-data-dir='))
  if (!profileArgument) throw Error('Browser tests require an isolated temporary profile')
  const profile = resolve(profileArgument.slice('--user-data-dir='.length))
  if (!profiles.has(profile) || !validProfile(profile)) {
    throw Error('Browser test profile must be a generated directory directly inside the disposable test profile folder')
  }
  const child = spawn(command, args, options)
  browsers.set(child, profile)
  return child
}

process.once('exit', () => {
  for (const child of browsers.keys()) {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }
  for (const profile of profiles) {
    try {
      // Chrome's child processes may release Windows file handles after the
      // browser exits. Give those handles a short bounded retry interval.
      rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 })
    } catch (error) {
      // The exit handler cannot await Chrome's Windows process teardown. A
      // detached helper retries after this process and its browser have exited.
      try {
        spawn(process.execPath, [cleanupScript, '--cleanup-profile', profile],
          { detached: true, stdio: 'ignore', windowsHide: true }).unref()
      } catch { console.warn(`Temporary browser profile cleanup failed: ${profile}: ${error.message}`) }
    }
  }
})
process.once('SIGINT', () => process.exit(130))
process.once('SIGTERM', () => process.exit(143))

if (process.argv[1] && resolve(process.argv[1]) === cleanupScript && process.argv[2] === '--cleanup-profile') {
  const profile = resolve(process.argv[3] ?? '')
  if (!validProfile(profile)) throw Error('Refusing cleanup outside the disposable browser-test directory')
  for (let attempt = 0; attempt < 30; attempt++) {
    try { rmSync(profile, { recursive: true, force: true }); break }
    catch (error) {
      if (attempt === 29) throw error
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }
}
