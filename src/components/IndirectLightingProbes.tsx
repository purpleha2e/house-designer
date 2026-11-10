/* eslint-disable react-hooks/immutability -- Diagnostic GPU buffers update outside React. */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { DataTexture, DataUtils, DynamicDrawUsage, HalfFloatType, InstancedBufferAttribute, InstancedMesh, Matrix4,
  NearestFilter, RGBAFormat, ShaderMaterial, SphereGeometry } from 'three'
import { INDIRECT_ATLAS_SIZE, type IndirectField } from '../indirectLighting'
import { indirectL2IrradianceGLSL } from '../indirectSH'

type ProbeSnapshot = { field: IndirectField; captured: ReadonlySet<number>; active?: number; completed: number; generation: number }

/** Display the actual relocated samples, without receiving or contributing light. */
export function IndirectLightingProbes({ snapshot }: { snapshot: () => ProbeSnapshot }) {
  const shOrder = snapshot().field.shOrder
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
    // Adding five vec3 instance attributes would exceed the WebGL2 minimum of
    // 16 vertex attributes. The optional second band uses one small texture.
    const higherData = shOrder === 2 ? new Uint16Array(capacity * 5 * 4) : null
    const higher = higherData ? new DataTexture(higherData, INDIRECT_ATLAS_SIZE * 5, INDIRECT_ATLAS_SIZE, RGBAFormat, HalfFloatType) : null
    if (higher) { higher.minFilter = higher.magFilter = NearestFilter; higher.generateMipmaps = false; higher.needsUpdate = true }
    const material = new ShaderMaterial({
      defines: shOrder === 2 ? { HD_GI_L2: 1 } : {},
      uniforms: { activeProbe: { value: -1 }, probeHigher: { value: higher } },
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
        #ifdef HD_GI_L2
        uniform sampler2D probeHigher;
        #endif
        varying vec3 light0, light1, light2, light3, sphereNormal, viewDirection;
        varying float index, captured;
        void main() {
          vec3 n = normalize(sphereNormal);
          vec3 light = .886227 * light0 + 1.023328 * (n.y * light1 + n.z * light2 + n.x * light3);
          #ifdef HD_GI_L2
            ${[4,5,6,7,8].map(i=>`vec3 c${i}=texture2D(probeHigher,vec2((mod(index,64.)*5.+${i-4}.5)/320.,(floor(index/64.)+.5)/64.)).rgb;`).join('\n')}
            light=light ${indirectL2IrradianceGLSL};
          #endif
          light=max(light,vec3(0.0));
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
    return { mesh, material, geometry, coefficients, higher, higherData, indices, captured, matrix: new Matrix4(),
      field: null as IndirectField | null, completed: -1, generation: -1 }
  }, [shOrder])

  useFrame(() => {
    const next = snapshot(), { field } = next
    resources.material.uniforms.activeProbe.value = next.active ?? -1
    if (resources.field === field && resources.completed === next.completed && resources.generation === next.generation) return
    resources.field = field; resources.completed = next.completed; resources.generation = next.generation
    resources.higherData?.fill(0)
    let count = 0
    for (const probe of field.probes) {
      const offset = probe.index * 4
      if (!field.positionData[offset + 3]) continue
      // The worker may move or disable a probe under roofs or inside furniture.
      resources.matrix.makeTranslation(field.positionData[offset], field.positionData[offset + 1], field.positionData[offset + 2])
      resources.mesh.setMatrixAt(count, resources.matrix)
      resources.indices.setX(count, probe.index)
      resources.captured.setX(count, next.captured.has(probe.index) ? 1 : 0)
      const coefficientOffset=probe.index*field.coefficientCount
      for (let i = 0; i < 4; i++) resources.coefficients[i].setXYZ(count,
        DataUtils.fromHalfFloat(field.coefficients[0][coefficientOffset + i]),
        DataUtils.fromHalfFloat(field.coefficients[1][coefficientOffset + i]),
        DataUtils.fromHalfFloat(field.coefficients[2][coefficientOffset + i]))
      if(resources.higherData)for(let k=4;k<9;k++)for(let c=0;c<3;c++)resources.higherData[(probe.index*5+k-4)*4+c]=field.coefficients[c][coefficientOffset+k]
      count++
    }
    resources.mesh.count = count
    resources.mesh.instanceMatrix.needsUpdate = true
    if(resources.higher)resources.higher.needsUpdate=true
    for (const attribute of [...resources.coefficients, resources.indices, resources.captured]) attribute.needsUpdate = true
  })
  useEffect(() => () => {
    resources.mesh.dispose(); resources.geometry.dispose(); resources.material.dispose(); resources.higher?.dispose()
  }, [resources])
  return <primitive object={resources.mesh} />
}
