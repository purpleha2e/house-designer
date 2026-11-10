import { createShaderProgramAudit } from './shaderProgramAudit.mjs'
const audit=createShaderProgramAudit()
Object.assign(window,{shaderProgramAudit:audit})
await import('./rendererIsolation.ts')
