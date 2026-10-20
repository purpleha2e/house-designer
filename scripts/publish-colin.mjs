import { spawnSync } from 'node:child_process'
import { copyFile, lstat, mkdir, readFile, readdir, unlink, open } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repository = 'https://github.com/purpleha2e/pitchr_privacy_policy.git'
const tourPath = 'house-designer/colin'
const tourUrl = 'https://www.pitchr.me/house-designer/colin/'

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, shell: false, windowsHide: true,
    encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed.${capture ? `\n${result.stderr.trim()}` : ''}`)
  return result.stdout?.trim() ?? ''
}

async function exists(path) {
  try { await lstat(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

async function directory(path) {
  if (await exists(path)) {
    const stat = await lstat(path)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Expected an ordinary directory: ${path}`)
  } else await mkdir(path)
}

async function copyTour(source, target) {
  await directory(target)
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.isSymbolicLink()) throw new Error(`Unexpected build entry: ${entry.name}`)
    const from = join(source, entry.name), to = join(target, entry.name)
    if (entry.isDirectory()) await copyTour(from, to)
    else if (entry.isFile()) {
      if (await exists(to)) {
        const stat = await lstat(to)
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Expected an ordinary file: ${to}`)
      }
      await copyFile(from, to)
    } else throw new Error(`Unsupported build entry: ${from}`)
  }
}

/** The CLI uses the fixed production destination; overrides allow local Git integration tests. */
export async function publishColin({ root = workspace, remote = repository, build = buildColin, log = console.log } = {}) {
  const cache = join(root, 'node_modules', '.cache')
  await mkdir(cache, { recursive: true })
  const lockPath = join(cache, 'publish-colin.lock')
  let lock
  try { lock = await open(lockPath, 'wx') } catch (error) {
    if (error.code !== 'EEXIST') throw error
    throw new Error(`Another Colin publish may be running. If an earlier run was interrupted, close it before removing ${lockPath}.`)
  }
  try {
    const site = join(cache, 'pitchr-site')
    const git = (...args) => run('git', ['-C', site, ...args], root, true)
    const check = () => {
      if (resolve(git('rev-parse', '--show-toplevel')) !== resolve(site)) throw new Error('Website checkout is not a separate Git repository.')
      if (git('remote', 'get-url', 'origin') !== remote || git('remote', 'get-url', '--push', 'origin') !== remote) {
        throw new Error('Website checkout has an unexpected origin. Nothing was published.')
      }
      if (git('branch', '--show-current') !== 'main') throw new Error('Website checkout must be on main.')
      if (git('status', '--porcelain')) throw new Error(`Website checkout has local changes. Review them in ${site} before publishing.`)
    }
    if (await exists(site)) { await directory(site); check() }
    log('Building Colin’s saved house and checking its saved lighting...')
    await build(root)
    const dist = join(root, 'dist-viewer')
    const entryHtml = await readFile(join(dist, 'index.html'))
    const revision = createHash('sha256').update(entryHtml).digest('hex').slice(0, 20)
    const freshTourUrl = `${tourUrl}?v=${revision}`
    const house = JSON.parse(await readFile(join(dist, 'house.json'), 'utf8'))
    if (!house.project?.floors?.length || !house.project.indirectLighting) throw new Error('The built tour is missing its house or saved lighting.')

    if (!(await exists(site))) run('git', ['clone', '--branch', 'main', '--single-branch', remote, site], root)
    check()
    log('Updating the website checkout...')
    git('fetch', 'origin', 'main')
    if (git('rev-list', '--count', 'origin/main..HEAD') !== '0') {
      throw new Error(`Website checkout has unpublished commits. Review them before retrying. A previous failed push can be retried with: git -C "${site}" push origin HEAD:main`)
    }
    git('merge', '--ff-only', 'origin/main')
    // Keep older hashed assets available to visitors who already have the tour open.
    // Only this house folder is copied and staged; other website pages are untouched.
    await directory(join(site, 'house-designer'))
    await copyTour(dist, join(site, tourPath))
    git('add', '--', tourPath)
    const changed = git('diff', '--cached', '--name-only').split('\n').filter(Boolean)
    if (changed.some(path => !path.startsWith(`${tourPath}/`))) throw new Error('Unexpected staged changes outside Colin’s tour. Nothing was published.')
    if (!changed.length) { log(`No changes to publish. Colin’s tour: ${freshTourUrl}`); return { published: false } }
    git('commit', '-m', 'Update Colin house tour')
    log('Publishing Colin’s tour...')
    try { git('push', 'origin', 'HEAD:main') } catch (error) {
      throw new Error(`${error.message}\nThe website commit is saved locally. Retry with: git -C "${site}" push origin HEAD:main`)
    }
    log(`Published to the website repository. GitHub Pages will deploy shortly.\nAfter deployment, open this update link (bypasses an older cached page): ${freshTourUrl}\nColin's usual link still works: ${tourUrl}`)
    return { published: true }
  } finally { await lock.close(); await unlink(lockPath) }
}

function buildColin(root) {
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-b'], root)
  run(process.execPath, ['--experimental-strip-types', join(root, 'scripts/build-viewer.mjs'),
    '--project', 'colin_house_v2.json', '--title', 'Colin'], root)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('Publish Colin’s saved house to his existing pitchr.me tour.\nFirst show all floors, wait for "ready to save with model", and save colin_house_v2.json.\nRun: npm run publish:colin\nRequires Node 24+, Git, and access to the website GitHub repository.')
  } else if (process.argv.length > 2) {
    console.error('Unknown arguments. Use --help for instructions.'); process.exitCode = 1
  } else {
    publishColin().catch(error => { console.error(`\nPublish stopped: ${error.message}`); process.exitCode = 1 })
  }
}
