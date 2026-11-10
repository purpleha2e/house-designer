import * as THREE from 'three'
import { installRendererAttributeDefaults } from '../../src/rendererAttributeDefaults'

const renderer = new THREE.WebGLRenderer()
renderer.setSize(8, 8)
document.body.appendChild(renderer.domElement)
const target = new THREE.WebGLRenderTarget(8, 8)
const camera = new THREE.Camera()
const scene = new THREE.Scene()
const geometry = new THREE.PlaneGeometry(2, 2)
const secondGeometry = geometry.clone()
const material = (colour: number[]) => new THREE.ShaderMaterial({
  vertexShader: 'attribute vec3 receiver; varying vec3 v; void main(){v=receiver;gl_Position=vec4(position,1.0);}',
  fragmentShader: 'varying vec3 v; void main(){gl_FragColor=vec4(v,1.0);}',
  defaultAttributeValues: { receiver: colour },
})
const red = material([1, 0, 0]), green = material([0, 1, 0]), blue = material([0, 0, 1])
const mesh = new THREE.Mesh(geometry, red)
scene.add(mesh)
renderer.setRenderTarget(target)
const draw = (g: THREE.BufferGeometry, m: THREE.ShaderMaterial) => {
  mesh.geometry = g; mesh.material = m
  renderer.render(scene, camera)
  const pixel = new Uint8Array(4)
  renderer.readRenderTargetPixels(target, 4, 4, 1, 1, pixel)
  return Array.from(pixel).slice(0, 3)
}
const before = [draw(geometry, red), draw(secondGeometry, green), draw(geometry, red)]
const originalDraw = renderer.getContext().drawElements
const dispose = installRendererAttributeDefaults(renderer)
const after = [draw(geometry, red), draw(secondGeometry, green), draw(geometry, red), draw(geometry, blue)]
const gl = renderer.getContext()
gl.vertexAttrib3f(gl.getAttribLocation(gl.getParameter(gl.CURRENT_PROGRAM), 'receiver'), 0, 1, 0)
after.push(draw(geometry, blue))
// Buffer attributes must take precedence over material defaults.
geometry.setAttribute('receiver', new THREE.Float32BufferAttribute(Array(4).fill([1, 1, 0]).flat(), 3))
after.push(draw(geometry, red))
dispose()
Object.assign(window, { attributeDefaultsResult: { before, after, restored: renderer.getContext().drawElements === originalDraw } })
renderer.dispose(); target.dispose(); geometry.dispose(); secondGeometry.dispose()
red.dispose(); green.dispose(); blue.dispose()
