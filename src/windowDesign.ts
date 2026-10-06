/** Editable window dimensions are metres; section coordinates start at the top left. */
export type WindowOpening = 'fixed' | 'top' | 'left' | 'right'
export type WindowSection =
  | { kind: 'pane'; opening: WindowOpening }
  | { kind: 'split'; axis: 'x' | 'y'; ratio: number; fixedFirst?: number; dividerWidth?: number; children: [WindowSection, WindowSection] }
export type WindowDesign = {
  version: 1
  width: number
  height: number
  depth: number
  frame: number
  divider: number
  color: string
  layout: WindowSection
}
export type WindowRect = { x: number; y: number; width: number; height: number }
export type WindowCell = WindowRect & { path: string; section: WindowSection; bounds?: WindowRect }
export const fixedPane = (): WindowSection => ({ kind: 'pane', opening: 'fixed' })

export function createWindowDesign(): WindowDesign {
  return { version: 1, width: 1.2, height: 1.2, depth: 0.08, frame: 0.06, divider: 0.05,
    color: '#f4f3ee', layout: fixedPane() }
}

export function getWindowDividerWidth(design: WindowDesign, section: Extract<WindowSection, { kind: 'split' }>) {
  return section.dividerWidth ?? design.divider
}

export function getWindowLayout(design: WindowDesign) {
  const panes: WindowCell[] = [], dividers: WindowCell[] = []
  function visit(section: WindowSection, rect: WindowRect, path: string, depth: number) {
    if (depth > 12) return // An invalid draft is reported by validation, without crashing its preview.
    if (section.kind === 'pane') { panes.push({ ...rect, path, section }); return }
    const horizontal = section.axis === 'x'
    const dividerWidth = getWindowDividerWidth(design, section)
    const span = (horizontal ? rect.width : rect.height) - dividerWidth
    const first = section.fixedFirst ?? span * section.ratio
    const second = span - first
    dividers.push({ ...rect, path, section, bounds: rect,
      x: rect.x + (horizontal ? first : 0), y: rect.y + (horizontal ? 0 : first),
      width: horizontal ? dividerWidth : rect.width, height: horizontal ? rect.height : dividerWidth })
    visit(section.children[0], { ...rect, width: horizontal ? first : rect.width,
      height: horizontal ? rect.height : first }, `${path}.0`, depth + 1)
    visit(section.children[1], { x: rect.x + (horizontal ? first + dividerWidth : 0),
      y: rect.y + (horizontal ? 0 : first + dividerWidth),
      width: horizontal ? second : rect.width, height: horizontal ? rect.height : second }, `${path}.1`, depth + 1)
  }
  visit(design.layout, { x: design.frame, y: design.frame,
    width: design.width - 2 * design.frame, height: design.height - 2 * design.frame }, 'r', 0)
  return { panes, dividers }
}

export function updateWindowSection(layout: WindowSection, path: string,
  update: (section: WindowSection) => WindowSection): WindowSection {
  const indices = path.split('.').slice(1).map(Number)
  function visit(section: WindowSection, level: number): WindowSection {
    if (level === indices.length) return update(section)
    if (section.kind !== 'split') return section
    return { ...section, children: section.children.map((child, i) => i === indices[level]
      ? visit(child, level + 1) : child) as [WindowSection, WindowSection] }
  }
  return visit(layout, 0)
}

export function windowPreset(design: WindowDesign, count: number): WindowSection {
  function columns(n: number, width: number): WindowSection {
    if (n === 1) return fixedPane()
    const paneWidth = (width - (n - 1) * design.divider) / n
    return { kind: 'split', axis: 'x', ratio: paneWidth / (width - design.divider),
      children: [fixedPane(), columns(n - 1, width - paneWidth - design.divider)] }
  }
  return columns(Math.max(1, Math.min(4, Math.round(count))), design.width - 2 * design.frame)
}

export function validateWindowDesign(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'The window design is missing.'
  const d = value as WindowDesign
  if (d.version !== 1) return 'Unsupported window design version.'
  for (const key of ['width', 'height', 'depth', 'frame', 'divider'] as const) {
    if (!Number.isFinite(d[key]) || d[key] <= 0) return 'Enter positive dimensions for the window and frame.'
  }
  if (d.width < 0.3 || d.height < 0.3 || d.width > 10 || d.height > 10) return 'Window width and height must be between 300 and 10,000 mm.'
  if (d.frame < 0.02 || d.frame > 0.2 || d.divider < 0.02 || d.divider > 0.2 || d.depth < 0.03 || d.depth > 0.5) return 'Frame and divider widths must be 20–200 mm; depth must be 30–500 mm.'
  if (!/^#[0-9a-f]{6}$/i.test(d.color)) return 'Choose a frame colour.'
  let count = 0
  let invalidDividerWidth = false
  function check(s: WindowSection, depth: number): boolean {
    if (!s || depth > 12 || ++count > 127) return false
    if (s.kind === 'pane') return ['fixed', 'top', 'left', 'right'].includes(s.opening)
    if (s.dividerWidth !== undefined && (!Number.isFinite(s.dividerWidth) || s.dividerWidth < 0.02 || s.dividerWidth > 0.2)) {
      invalidDividerWidth = true
      return false
    }
    return s.kind === 'split' && ['x', 'y'].includes(s.axis) && Number.isFinite(s.ratio) && s.ratio > 0 && s.ratio < 1 &&
      (s.fixedFirst === undefined || (Number.isFinite(s.fixedFirst) && s.fixedFirst > 0)) &&
      Array.isArray(s.children) && s.children.length === 2 && s.children.every(c => check(c, depth + 1))
  }
  if (!check(d.layout, 0)) return invalidDividerWidth ? 'Individual divider widths must be between 20 and 200 mm.' : 'The pane layout is invalid or has too many splits.'
  const { panes } = getWindowLayout(d)
  if (panes.some(p => p.width < 0.1 - 1e-8 || p.height < 0.1 - 1e-8)) return 'Each pane needs at least 100 mm of width and height. Move a divider, remove a split, or enlarge the window.'
  return null
}

export function windowThumbnail(design: WindowDesign) {
  const { panes, dividers } = getWindowLayout(design)
  const rect = (r: WindowRect, fill: string) => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${fill}"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${design.width} ${design.height}">${rect({x:0,y:0,width:design.width,height:design.height}, design.color)}${panes.map(p => rect(p, '#a8cfdf')).join('')}${dividers.map(p => rect(p, design.color)).join('')}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
