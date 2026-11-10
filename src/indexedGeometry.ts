import { BufferAttribute, type BufferGeometry } from 'three'

/** Exact vertex sharing across every attribute, preserving hard edges, UV seams
 * and per-face lighting data. The triangle stream and group offsets are unchanged. */
export function indexGeometry(source: BufferGeometry) {
  const attributes = Object.entries(source.attributes)
  for (const [, attribute] of attributes) {
    if (!(attribute instanceof BufferAttribute)) throw new Error('Indexing requires non-interleaved attributes')
  }
  const vertices = new Map<string, number>(), unique: number[] = [], indices: number[] = []
  const count = source.index?.count ?? source.getAttribute('position').count
  for (let i = 0; i < count; i++) {
    const vertex = source.index?.getX(i) ?? i
    const key = attributes.map(([, attribute]) => {
      const start = vertex * attribute.itemSize
      return Array.from(attribute.array.slice(start, start + attribute.itemSize)).join(',')
    }).join(';')
    let index = vertices.get(key)
    if (index === undefined) {
      index = unique.length
      vertices.set(key, index)
      unique.push(vertex)
    }
    indices.push(index)
  }
  const result = source.clone()
  for (const [name, attribute] of attributes) {
    const values = attribute.array.slice(0, unique.length * attribute.itemSize)
    unique.forEach((vertex, index) => {
      for (let component = 0; component < attribute.itemSize; component++) {
        values[index * attribute.itemSize + component] = attribute.array[vertex * attribute.itemSize + component]
      }
    })
    result.setAttribute(name, new BufferAttribute(values, attribute.itemSize, attribute.normalized))
  }
  result.setIndex(indices)
  return result
}
