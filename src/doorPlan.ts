import type { ModelDefinition } from './models/modelLibrary'

export function isPlanDoor(definition: ModelDefinition) {
  return definition.wallMount === 'interior-door' || definition.wallMount === 'exterior-door' ||
    definition.wallMount === 'patio-door'
}

export function getDoorLeafCount(definition: ModelDefinition): 1 | 2 {
  if (definition.doorLeafCount === 1 || definition.doorLeafCount === 2) return definition.doorLeafCount
  // Older saved and uploaded models have no leaf metadata. Use their identity,
  // never their placed width: widening a single door must not turn it into two.
  return /\b(double|french)\b/i.test(`${definition.id.replaceAll('-', ' ')} ${definition.name}`) ||
    definition.wallMount === 'patio-door' ? 2 : 1
}
