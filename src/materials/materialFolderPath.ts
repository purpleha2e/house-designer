export function normalizeMaterialFolder(path: string) {
  const parts = path.split('/').map(part => part.trim()).filter(Boolean)
  if (parts.length > 8 || path.length > 512 || parts.some(part =>
    part === '.' || part === '..' || part.length > 80 || part.includes('\\') || [...part].some(character => character.charCodeAt(0) < 32))) {
    throw new Error('Use up to eight folder levels, with names shorter than 80 characters.')
  }
  return parts.join('/')
}
