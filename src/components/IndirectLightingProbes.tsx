/* eslint-disable react-hooks/immutability -- Diagnostic GPU buffers update outside React. */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { DataUtils, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4,
  ShaderMaterial, SphereGeometry } from 'three'
import { INDIRECT_ATLAS_SIZE, type IndirectField } from '../indirectLighting'

type ProbeSnapshot = { field: IndirectField; captured: ReadonlySet<number>; active?: number; completed: number; generation: number }

/** Display the actual relocated samples, without receiving or contributing light. */
export function IndirectLightingProbes({ snapshot }: { snapshot: () => ProbeSnapshot }) {
  const resources = useMemo(() => {
    const capacity = INDIRECT_ATLAS_SIZE ** 2
    const geometry = new SphereGeometry(.09, 16, 12)
    const coefficients = Array.from({ length: 4 }, (_, i) => {
      const attribute = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage)
      geometry.setAttribute(`probeSH${i}`, attribute)
      return attribute
    })
    const indices = new InstancedBufferAttribute(new Float32Array(capacity), 1)
    const captured = new InstancedBufferAttribute(new Float32Array(capacity), 1)
    geometry.setAttribute('probeIndex', indices); geometry.setAttribute('probeCaptured', captured)
    const material = new ShaderMaterial({
      uniforms: { activeProbe: { value: -1 } },
      vertexShader: /* glsl */ `
        attribute vec3 probeSH0, probeSH1, probeSH2, probeSH3;
        attribute float probeIndex, probeCaptured;
        varying vec3 light0, light1, light2, light3, sphereNormal, viewDirection;
        varying float index, captured;
        void main() {
          light0 = probeSH0; light1 = probeSH1; light2 = probeSH2; light3 = probeSH3;
          index = probeIndex; captured = probeCaptured; sphereNormal = normal;
          vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
          viewDirection = cameraPosition - world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform float activeProbe;
        varying vec3 light0, light1, light2, light3, sphereNormal, viewDirection;
        varying float index, captured;
        void main() {
          vec3 n = normalize(sphereNormal);
          vec3 light = max(vec3(0.0), .886227 * light0 + 1.023328 * (n.y * light1 + n.z * light2 + n.x * light3));
          vec3 colour = captured > .5 ? light : vec3(.12, .17, .23);
          // A cyan rim keeps measured black samples visible. Amber means capturing.
          if (abs(dot(n, normalize(viewDirection))) < .35) colour = vec3(.04, .65, .8);
          if (abs(index - activeProbe) < .5) colour = vec3(1.0, .55, .04);
          gl_FragColor = vec4(colour, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
    const mesh = new InstancedMesh(geometry, material, capacity)
    mesh.name = 'indirect-lighting-probes'
    mesh.userData.selectionDecoration = true
    mesh.userData.houseDesignerRole = 'gi-probes'
    mesh.frustumCulled = false; mesh.count = 0
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.raycast = () => {} // Probes never intercept editor picking.
    return { mesh, material, geometry, coefficients, indices, captured, matrix: new Matrix4(),
      field: null as IndirectField | null, completed: -1, generation: -1 }
  }, [])

  useFrame(() => {
    const next = snapshot(), { field } = next
    resources.material.uniforms.activeProbe.value = next.active ?? -1
    if (resources.field === field && resources.completed === next.completed && resources.generation === next.generation) return
    resources.field = field; resources.completed = next.completed; resources.generation = next.generation
    let count = 0
    for (const probe of field.probes) {
      const offset = probe.index * 4
      if (!field.positionData[offset + 3]) continue
      // The worker may move or disable a probe under roofs or inside furniture.
      resources.matrix.makeTranslation(field.positionData[offset], field.positionData[offset + 1], field.positionData[offset + 2])
      resources.mesh.setMatrixAt(count, resources.matrix)
      resources.indices.setX(count, probe.index)
      resources.captured.setX(count, next.captured.has(probe.index) ? 1 : 0)
      for (let i = 0; i < 4; i++) resources.coefficients[i].setXYZ(count,
        DataUtils.fromHalfFloat(field.coefficients[0][offset + i]),
        DataUtils.fromHalfFloat(field.coefficients[1][offset + i]),
        DataUtils.fromHalfFloat(field.coefficients[2][offset + i]))
      count++
    }
    resources.mesh.count = count
    resources.mesh.instanceMatrix.needsUpdate = true
    for (const attribute of [...resources.coefficients, resources.indices, resources.captured]) attribute.needsUpdate = true
  })
  useEffect(() => () => {
    resources.mesh.dispose(); resources.geometry.dispose(); resources.material.dispose()
  }, [resources])
  return <primitive object={resources.mesh} />
}
