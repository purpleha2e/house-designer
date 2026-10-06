export type ToolbarIconName = 'menu' | 'move' | 'rotate' | 'scale' | 'minus' | 'plus' | 'normal' | 'wide' | 'super-wide'

export function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  const paths: Partial<Record<ToolbarIconName, string>> = {
    menu: 'M4 6h16M4 12h16M4 18h16',
    move: 'M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3',
    rotate: 'M4 10a8 8 0 1 1 1 7M4 4v6h6',
    scale: 'M4 14v6h6M14 4h6v6M4 20l6-6m4-4 6-6',
    minus: 'M5 12h14',
    plus: 'M5 12h14M12 5v14',
  }
  const height = name === 'normal' ? 16 : name === 'wide' ? 11 : 7
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths[name] ? <path d={paths[name]} /> : <rect x="2" y={(24 - height) / 2} width="20" height={height} rx="1.5" />}
  </svg>
}
