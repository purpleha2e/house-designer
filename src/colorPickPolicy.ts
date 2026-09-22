export type ColorPickTargetKind =
  | 'material-groups'
  | 'model'
  | 'roof'
  | 'room-surface-area'
  | 'surface'

export function participatesInColorPick(kind: ColorPickTargetKind) {
  return kind !== 'room-surface-area'
}
