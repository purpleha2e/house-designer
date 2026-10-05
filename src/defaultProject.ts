// Set the startup house model here. Use one exact JSON path relative to this file.
// The editor filename is derived from the same path, so it stays in sync.
const projects = import.meta.glob('../colin_house.json', {
  eager: true,
  import: 'default',
})

const entries = Object.entries(projects)
if (entries.length !== 1) {
  throw new Error('The default project setting must match exactly one JSON file.')
}

const [path, project] = entries[0]
export const defaultProject = {
  data: project,
  fileName: path.split('/').pop()!,
}
