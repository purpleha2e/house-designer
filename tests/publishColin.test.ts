import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { publishColin } from '../scripts/publish-colin.mjs'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, {
  cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_AUTHOR_NAME: 'Tour test', GIT_AUTHOR_EMAIL: 'tour@example.test',
    GIT_COMMITTER_NAME: 'Tour test', GIT_COMMITTER_EMAIL: 'tour@example.test' },
}).trim()

async function fixture() {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'publish-colin-test-'))
  const remote = join(root, 'website.git'), seed = join(root, 'seed')
  await mkdir(seed)
  git(root, 'init', '--bare', '--initial-branch=main', remote)
  git(seed, 'init', '--initial-branch=main')
  await writeFile(join(seed, 'index.html'), 'Existing website home')
  await writeFile(join(seed, 'CNAME'), 'www.pitchr.me')
  await writeFile(join(seed, '.nojekyll'), '')
  git(seed, 'add', '.'); git(seed, 'commit', '-m', 'Initial website')
  git(seed, 'remote', 'add', 'origin', remote); git(seed, 'push', 'origin', 'main')
  const site = join(root, 'node_modules', '.cache', 'pitchr-site')
  // Use local Git identities in the fixture checkout, independent of user config.
  await mkdir(dirname(site), { recursive: true })
  git(root, 'clone', remote, site)
  git(site, 'config', 'user.name', 'Tour test'); git(site, 'config', 'user.email', 'tour@example.test')
  let builds = 0
  const build = async () => {
    builds++
    await mkdir(join(root, 'dist-viewer', 'assets'), { recursive: true })
    await writeFile(join(root, 'dist-viewer', 'index.html'), '<script src="./assets/tour.js"></script>')
    await writeFile(join(root, 'dist-viewer', 'assets', 'tour.js'), 'Tour build')
    await writeFile(join(root, 'dist-viewer', 'house.json'), JSON.stringify({ project: { floors: [{ id: 'ground' }], indirectLighting: { saved: true } } }))
  }
  return { root, remote, site, build, builds: () => builds,
    publish: (overrides = {}) => publishColin({ root, remote, build, log: () => {}, ...overrides }),
    head: () => git(root, '--git-dir', remote, 'rev-parse', 'main'),
    cleanup: async () => {
      assert.equal(dirname(resolve(root)), parent)
      assert.ok(root.startsWith(join(parent, 'publish-colin-test-')))
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('publishes only Colin’s folder to a real Git remote, and repeated builds do not create commits', async () => {
  const f = await fixture()
  try {
    const initial = f.head()
    assert.deepEqual(await f.publish(), { published: true })
    const published = f.head()
    assert.notEqual(published, initial)
    assert.equal(git(f.root, '--git-dir', f.remote, 'show', 'main:house-designer/colin/assets/tour.js'), 'Tour build')
    assert.equal(git(f.root, '--git-dir', f.remote, 'show', 'main:index.html'), 'Existing website home')
    assert.equal(git(f.root, '--git-dir', f.remote, 'show', 'main:CNAME'), 'www.pitchr.me')
    assert.equal(git(f.site, 'status', '--porcelain'), '')
    assert.deepEqual(await f.publish(), { published: false })
    assert.equal(f.head(), published)
    assert.equal(f.builds(), 2)
  } finally { await f.cleanup() }
})

test('failed builds cannot publish an old package and release the publish lock', async () => {
  const f = await fixture()
  try {
    await f.build() // Simulate a stale dist-viewer from an earlier build.
    const initial = f.head()
    await assert.rejects(f.publish({ build: async () => { throw new Error('Saved lighting is stale') } }), /lighting is stale/)
    assert.equal(f.head(), initial)
    assert.equal(git(f.site, 'status', '--porcelain'), '')
    assert.deepEqual(await f.publish(), { published: true })
  } finally { await f.cleanup() }
})

test('refuses dirty checkouts, unexpected push destinations and unpublished commits', async () => {
  const f = await fixture()
  try {
    const initial = f.head()
    await writeFile(join(f.site, 'index.html'), 'Unrelated local edits')
    await assert.rejects(f.publish(), /local changes/)
    assert.equal(await readFile(join(f.site, 'index.html'), 'utf8'), 'Unrelated local edits')
    assert.equal(f.builds(), 0)
    git(f.site, 'add', 'index.html'); git(f.site, 'commit', '-m', 'Unpublished website edit')
    await assert.rejects(f.publish(), /unpublished commits/)
    assert.equal(f.head(), initial)
    git(f.site, 'remote', 'set-url', '--push', 'origin', join(f.root, 'wrong.git'))
    await assert.rejects(f.publish(), /unexpected origin/)
    assert.equal(f.head(), initial)
  } finally { await f.cleanup() }
})
