import { createContext } from 'react'
import type { Texture } from 'three'

export const PbrEnvironmentContext = createContext<{ intensity: number; map: Texture | null }>({ intensity: 0, map: null })
