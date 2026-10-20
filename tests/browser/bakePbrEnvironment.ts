import { PMREMGenerator, WebGLRenderer } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { createSkyReflectionEnvironment } from '../../src/skyReflectionEnvironment'
const renderer = new WebGLRenderer(), generator = new PMREMGenerator(renderer), scene = new RoomEnvironment()
const sky = new URLSearchParams(location.search).has('sky') ? createSkyReflectionEnvironment() : null
const target = sky ? generator.fromEquirectangular(sky) : generator.fromScene(scene, .04)
const pixels = new Uint16Array(target.width * target.height * 4)
await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height, pixels)
const bytes = new Uint8Array(pixels.buffer)
let binary = ''
for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
Object.assign(window, { bakedPbrEnvironment: { width: target.width, height: target.height, base64: btoa(binary) } })
target.dispose(); generator.dispose(); scene.dispose(); sky?.dispose(); renderer.dispose()
