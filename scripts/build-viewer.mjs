import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, createServer } from 'vite'
import { createRuntimePortalCatalog } from '../src/portalCatalog.ts'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const staging = resolve(workspace, '.viewer-data')
const publicDir = resolve(staging, 'public')

export function collectStrings(value, result = new Set()) {
  if (typeof value === 'string') result.add(value)
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collectStrings(item, result))
  return result
}

function inside(root, path) {
  const suffix = relative(root, path)
  if (suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) throw new Error(`Asset is outside the allowed directory: ${path}`)
  return suffix
}

async function metadataFiles(root) {
  const result = []
  for (const entry of await readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })) {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) result.push(...await metadataFiles(path))
    else if (entry.name === 'metadata.json') result.push(path)
  }
  return result
}

async function prepare(projectPath, title) {
  const project = JSON.parse(await readFile(projectPath, 'utf8'))
  if (!Array.isArray(project.floors) || !project.floors.length) throw new Error('Choose a saved House Designer project with at least one floor.')
  const usedModelIds = new Set(project.floors.flatMap(floor => (floor.models ?? []).map(model => model.modelId)))
  const strings = collectStrings(project)
  const usedMaterialIds = new Set([...strings].filter(value => value.startsWith('portal-material-')))
  const usedPortalModelIds = new Set([...usedModelIds].filter(value => value.startsWith('portal-model-')))
  const assets = []
  for (const path of await metadataFiles(resolve(workspace, 'manufacturer-assets'))) {
    const asset = JSON.parse(await readFile(path, 'utf8'))
    const id = `portal-${asset.assetKind}-${asset.id}`
    if (usedMaterialIds.has(id) || usedPortalModelIds.has(id)) assets.push(asset)
  }
  const catalog = createRuntimePortalCatalog({ manufacturers: [{ assets }] })
  for (const id of usedMaterialIds) {
    if (!catalog.materials.some(material => material.id === id)) throw new Error(`Missing published material ${id}. Restore its local manufacturer assets before building this viewer.`)
  }
  const definitions = [...catalog.models, ...(project.modelDefinitions ?? [])]
    .filter(model => usedModelIds.has(model.id))
  const mergedDefinitions = [...new Map(definitions.map(model => [model.id, model])).values()]
  for (const id of usedPortalModelIds) {
    if (!mergedDefinitions.some(model => model.id === id)) throw new Error(`Missing model definition ${id}. Restore its local manufacturer assets before building this viewer.`)
  }

  // Only this known generated directory may be replaced; never the source project.
  inside(workspace, staging)
  await rm(staging, { recursive: true, force: true })
  await mkdir(publicDir, { recursive: true })
  const copied = new Set()
  const copyAsset = async path => {
    const suffix = inside(workspace, path)
    if (copied.has(path)) return
    const destination = resolve(publicDir, 'published-assets', suffix)
    inside(publicDir, destination)
    await mkdir(dirname(destination), { recursive: true })
    await cp(path, destination)
    copied.add(path)
    if (['.gltf', '.glb'].includes(extname(path).toLowerCase())) {
      const data = await readFile(path)
      const gltf = extname(path).toLowerCase() === '.gltf' ? JSON.parse(data.toString())
        : JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12)))
      for (const entry of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
        if (!entry.uri || entry.uri.startsWith('data:')) continue
        if (/^(https?:|blob:|\/)/.test(entry.uri)) throw new Error(`Model has an external dependency: ${entry.uri}. Embed it before publishing.`)
        await copyAsset(resolve(dirname(path), decodeURIComponent(entry.uri)))
      }
    }
  }
  const portableUrl = async url => {
    if (!url || url.startsWith('data:')) return url
    if (/^(https?:|blob:)/.test(url)) throw new Error(`Asset must be local before publishing: ${url}`)
    const path = resolve(workspace, decodeURIComponent(url.replace(/^\//, '').split(/[?#]/)[0]))
    await copyAsset(path)
    return `./published-assets/${inside(workspace, path).split(sep).map(encodeURIComponent).join('/')}`
  }
  for (const model of mergedDefinitions) {
    model.sourceUrl = await portableUrl(model.sourceUrl)
    // Tour UI has no catalogue thumbnails.
    delete model.previewUrl
  }
  for (const material of catalog.materials) {
    for (const key of Object.keys(material.pbr)) {
      if (key.endsWith('TextureUrl')) material.pbr[key] = await portableUrl(material.pbr[key])
    }
  }
  const house = { title, materials: catalog.materials, project: {
    activeFloorId: project.activeFloorId,
    floors: project.floors.map(({ groundImage, ...floor }) => floor),
    modelDefinitions: mergedDefinitions,
    surfaceAssignments: project.surfaceAssignments ?? [],
    sunPosition: project.sunPosition,
    threeDView: project.threeDView,
  } }
  await writeFile(resolve(publicDir, 'house.json'), JSON.stringify(house))
  await writeFile(resolve(publicDir, '.nojekyll'), '')
  console.log(`Prepared ${title}: ${project.floors.length} floors, ${catalog.materials.length} uploaded materials, ${copied.size} asset files.`)
  return usedModelIds
}

// The full editor catalogue is unnecessary in a single house's viewer bundle.
function houseModelsPlugin(usedModelIds) {
  return { name: 'house-viewer-models', enforce: 'pre', transform(source, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/models/modelLibrary.ts')) return
    const globs = ['./assets/*.{glb,gltf}']
    return (async () => {
      for (const file of await readdir(resolve(workspace, 'src/models/assets'))) {
        if (!/\.(glb|gltf)$/i.test(file)) continue
        const modelId = file.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
        if (!usedModelIds.has(modelId)) globs.push(`!./assets/${file}`)
      }
      return { code: source.replace("import.meta.glob('./assets/*.{glb,gltf}',", `import.meta.glob(${JSON.stringify(globs)},`), map: null }
    })()
  } }
}

async function main() {
  const args = process.argv.slice(2)
  const option = name => {
    const index = args.indexOf(name)
    return index < 0 ? undefined : args[index + 1]
  }
  const projectArg = option('--project')
  if (!projectArg) throw new Error('Usage: npm run build:viewer -- --project house.json --title "House name"\nAdd --serve to preview the viewer locally.')
  const projectPath = resolve(workspace, projectArg)
  const title = option('--title') ?? basename(projectPath, extname(projectPath)).replaceAll('_', ' ')
  const usedModelIds = await prepare(projectPath, title)
  const config = { configFile: resolve(workspace, 'vite.viewer.config.ts'), plugins: [houseModelsPlugin(usedModelIds)] }
  if (args.includes('--serve')) {
    const server = await createServer({ ...config, base: '/', server: { host: '127.0.0.1', port: Number(option('--port') ?? 5183), strictPort: true } })
    await server.listen()
    server.printUrls()
  } else {
    await build(config)
    console.log('Viewer ready in dist-viewer/. Copy its contents into any house folder in the existing website, e.g. house-designer/colin/.')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
