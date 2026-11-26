import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { normalizePath } from 'vite'
import { readModelMaterialNames } from '../server/model-material-names.mjs'

const moduleId = 'virtual:bundled-model-materials'
const resolvedId = `\0${moduleId}`
const modelExtension = /\.(glb|gltf)$/i

/** @returns {import('vite').Plugin} */
export function bundledModelMaterials(assetDirectory) {
  const watchedDirectory = normalizePath(assetDirectory)
  let building = false
  return {
    name: 'house-bundled-model-materials',
    configResolved(config) {
      building = config.command === 'build'
    },
    configureServer(server) {
      server.watcher.add(watchedDirectory)
    },
    resolveId(id) {
      if (id === moduleId) return resolvedId
    },
    async load(id) {
      if (id !== resolvedId) return
      const files = await readdir(assetDirectory, { withFileTypes: true })
      const entries = await Promise.all(files.filter(file => file.isFile() && modelExtension.test(file.name)).map(async file => {
        const path = join(assetDirectory, file.name)
        if (building) this.addWatchFile(path)
        try {
          const names = await readModelMaterialNames(path)
          return [file.name, names.filter(name => /^hd_/i.test(name))]
        } catch (error) {
          this.warn(`Could not read material slots from ${file.name}: ${error.message}`)
          return [file.name, []]
        }
      }))
      return `export default ${JSON.stringify(Object.fromEntries(entries.filter(([, names]) => names.length)))}`
    },
    hotUpdate({ file, modules }) {
      if (!modelExtension.test(file) || normalizePath(dirname(file)) !== watchedDirectory) return
      const catalogue = this.environment.moduleGraph.getModuleById(resolvedId)
      if (catalogue && !modules.includes(catalogue)) return [...modules, catalogue]
    },
  }
}
