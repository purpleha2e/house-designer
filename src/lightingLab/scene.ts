import { Vector3 } from 'three'
import { LAB_SKY_COLOUR } from './calibration'

export type Card = { name: string; centre: Vector3; u: Vector3; v: Vector3; colour: Vector3; kind: number }
export const TILE = 32
export const COLUMNS = 8
export const MAX_CARDS = 48
export const cabinetSize = new Vector3(.85, 1.35, .85)
export const cabinetCentre = new Vector3(-1.3, cabinetSize.y / 2, 0)

/** Analytic planar cards are also the visible geometry in this experiment.
 * No imported-mesh capture, SDF generation or hidden offline bake is involved. */
export function createCards() {
  const cards: Card[] = []
  const add = (name: string, centre: number[], u: number[], v: number[], kind = 0, colour = [.72, .70, .65]) => {
    cards.push({ name, centre: new Vector3(...centre), u: new Vector3(...u), v: new Vector3(...v), colour: new Vector3(...colour), kind })
  }
  for (const x of [-2, 2]) {
    const room = x < 0 ? 'Left' : 'Right'
    add(`${room} floor`, [x, 0, 0], [2, 0, 0], [0, 0, -3], 1, [.39, .29, .19])
    add(`${room} ceiling`, [x, 3, 0], [2, 0, 0], [0, 0, 3])
    add(`${room} front wall`, [x, 1.5, 3], [-2, 0, 0], [0, 1.5, 0])
    // A real aperture represented by four pieces of wall and an emissive sky card.
    add(`${room} below window`, [x, .45, -3], [2, 0, 0], [0, .45, 0])
    add(`${room} above window`, [x, 2.7, -3], [2, 0, 0], [0, .3, 0])
    for (const dx of [-1.55, 1.55]) add(`${room} window side`, [x + dx, 1.65, -3], [.45, 0, 0], [0, .75, 0])
    add(`${room} sky`, [x, 1.65, -3.01], [1.1, 0, 0], [0, .75, 0], 3, [...LAB_SKY_COLOUR])
  }
  add('Left side wall', [-4, 1.5, 0], [0, 0, -3], [0, 1.5, 0])
  add('Right side wall', [4, 1.5, 0], [0, 0, 3], [0, 1.5, 0])
  for (const side of [-1, 1]) {
    for (const z of [-1.9, 1.9]) add('Partition', [side * .06, 1.5, z], [0, 0, -side * 1.1], [0, 1.5, 0])
    add('Door header', [side * .06, 2.6, 0], [0, 0, -side * .8], [0, .4, 0])
  }
  add('Door jamb', [0, 1.1, -.8], [.06, 0, 0], [0, 1.1, 0])
  add('Door jamb', [0, 1.1, .8], [-.06, 0, 0], [0, 1.1, 0])
  add('Door soffit', [0, 2.2, 0], [.06, 0, 0], [0, 0, .8])
  const cabinetStart = cards.length
  const { x, y, z } = cabinetSize.clone().multiplyScalar(.5)
  add('Cabinet right', [x, 0, 0], [0, 0, -z], [0, y, 0], 2, [.32, .19, .09])
  add('Cabinet left', [-x, 0, 0], [0, 0, z], [0, y, 0], 2, [.32, .19, .09])
  add('Cabinet top', [0, y, 0], [x, 0, 0], [0, 0, -z], 2, [.32, .19, .09])
  add('Cabinet base', [0, -y, 0], [x, 0, 0], [0, 0, z], 2, [.32, .19, .09])
  add('Cabinet front', [0, 0, z], [x, 0, 0], [0, y, 0], 2, [.32, .19, .09])
  add('Cabinet back', [0, 0, -z], [-x, 0, 0], [0, y, 0], 2, [.32, .19, .09])
  const offsets = cards.slice(cabinetStart).map(card => card.centre.clone())
  const moveCabinet = (centre: Vector3) => cards.slice(cabinetStart).forEach((card, index) => card.centre.copy(offsets[index]).add(centre))
  moveCabinet(cabinetCentre)
  if (cards.length > MAX_CARDS) throw Error('Surface-card capacity exceeded')
  return { cards, cabinetStart, moveCabinet }
}
