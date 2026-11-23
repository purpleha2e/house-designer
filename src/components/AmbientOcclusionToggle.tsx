import { useLayoutEffect, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { EffectComposer } from 'postprocessing'
import type { Scene } from 'three'
import type { AmbientOcclusionPass } from '../ambientOcclusionResources'

const opaquePasses = new WeakSet<AmbientOcclusionPass>()

function syncAmbientOcclusion(composer: EffectComposer | null, enabled: boolean, opaqueDepthOnly: boolean, scene: Scene, invalidate: () => void) {
  const pass = composer?.passes.find(pass => 'renderTransparency' in pass) as
    (AmbientOcclusionPass & { enabled: boolean }) | undefined
  if (!pass) return
  const changedDepth = opaquePasses.has(pass) !== opaqueDepthOnly
  if (changedDepth && pass.configuration) {
    if (opaqueDepthOnly) {
      opaquePasses.add(pass)
      pass.autoDetectTransparency = false
      pass.configuration.transparencyAware = false
    } else {
      opaquePasses.delete(pass)
      pass.autoDetectTransparency = true
    }
  }
  if (pass.enabled === enabled && !changedDepth) return
  pass.enabled = enabled
  if (enabled) pass.firstFrame?.()
  scene.userData.displayEffectRevision = (scene.userData.displayEffectRevision ?? 0) + 1
  invalidate()
}

/** Keep the compositor, targets and programs alive when bypassing AO. */
export function AmbientOcclusionToggle({ composer, enabled, opaqueDepthOnly = false }: {
  composer: RefObject<EffectComposer | null>; enabled: boolean; opaqueDepthOnly?: boolean
}) {
  const { scene, invalidate } = useThree()
  useLayoutEffect(() => { syncAmbientOcclusion(composer.current, enabled, opaqueDepthOnly, scene, invalidate) }, [composer, enabled, opaqueDepthOnly, scene, invalidate])
  // EffectComposer creates its passes after mounting. Apply the initial setting
  // before SceneRenderer's first draw, including an initially disabled AO pass.
  useFrame(() => { syncAmbientOcclusion(composer.current, enabled, opaqueDepthOnly, scene, invalidate) })
  return null
}
