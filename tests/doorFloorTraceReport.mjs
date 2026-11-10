import fs from 'node:fs'
import sharp from 'sharp'

const dir='docs/door-floor-streak/'
const read=name=>JSON.parse(fs.readFileSync(dir+name,'utf8').replace(/^\uFEFF/,''))
const original=read('original-trace.json'),moved=read('moved-trace.json'),fresh=read('fresh-original.json')
const f=n=>n.toFixed(5),ref=p=>p.reference.sky[0]+p.reference.reflected[0]
const weight=p=>p.links.find(l=>l.index===590)?.normalizedWeight??0
const delta=Math.max(...fresh.points.flatMap((p,i)=>p.irradiance.rgb.map((v,c)=>Math.abs(v-original.points[i].filtered.rgb[c]))))
const mismatch=[...original.points,...moved.points].flatMap(p=>p.links).filter(l=>l.visibility!==l.independentVisibility).length
const path=(points,x,y,value)=>points.map((p,i)=>`${i?'L':'M'}${x(p.position[0]).toFixed(2)},${y(value(p)).toFixed(2)}`).join(' ')
let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="720" viewBox="0 0 1120 720"><rect width="1120" height="720" fill="white"/><g font-family="Arial" font-size="14" fill="#203040">'
svg+='<text x="40" y="30" font-size="22">Door-gap GI: measured probe visibility discontinuity</text>'
for(const [points,title,left,min,max] of [[original.points,'Original door',65,1.72,2.4],[moved.points,'Door translated 0.4 m along -X',620,.75,2.25]]){
 const x=v=>left+440*(v-min)/(max-min),y=v=>330-v*390
 svg+=`<text x="${left}" y="65" font-size="18">${title}</text>`
 for(const value of [0,.2,.4,.6])svg+=`<path d="M${left},${y(value)}h440" stroke="#ddd"/><text x="${left-37}" y="${y(value)+4}">${value.toFixed(1)}</text>`
 svg+=`<path d="${path(points,x,y,p=>p.filtered.rgb[0])}" fill="none" stroke="#b22935" stroke-width="2.5"/><path d="${path(points,x,y,ref)}" fill="none" stroke="#117b69" stroke-width="2.5"/>`
 for(const p of points){const error=Math.hypot(p.reference.skyStandardError[0],p.reference.reflectedStandardError[0]);svg+=`<path d="M${x(p.position[0])},${y(ref(p)-2*error)}V${y(ref(p)+2*error)}" stroke="#117b69" opacity=".35"/>`}
 for(const value of [min,(min+max)/2,max])svg+=`<text x="${x(value)-13}" y="352">${value.toFixed(2)}</text>`
 svg+=`<text x="${left+140}" y="375">World X (m), Z = 15.123 m</text>`
}
svg+='<text x="65" y="408" fill="#b22935">Red: stored GI irradiance (R)</text><text x="380" y="408" fill="#117b69">Green: independent diffuse reference (R), approximate +/- 2 standard errors</text>'
const xx=v=>65+440*(v-1.72)/(.68),yy=v=>645-v*900
svg+='<text x="65" y="455" font-size="18">Original probe 590: normalized weight</text>'
svg+=`<path d="${path(original.points,xx,yy,weight)}" fill="none" stroke="#7353a6" stroke-width="3"/><path d="M65,645h440" stroke="#aaa"/><text x="35" y="649">0</text><text x="20" y="469">20%</text>`
svg+='<text x="620" y="455" font-size="18">Why the narrow notch appears</text><text x="620" y="489">1. Door leaf blocks probe 590: weight 0.</text><text x="620" y="522">2. Ray passes through leaf/frame gap: weight 17.7-18.1%.</text><text x="620" y="555">3. Door frame blocks it again: weight 0.</text><text x="620" y="594">Probe 590 irradiance R = 0.1892; surrounding blend ~0.565.</text><text x="620" y="628">The reference does not reproduce the narrow 0.499 notch.</text><text x="65" y="693">Fresh original bake reproduces all 17 stored sample RGBs exactly. These are diagnostic results, not a validated fix.</text></g></svg>'
fs.writeFileSync(dir+'comparison.svg',svg)
await sharp(Buffer.from(svg)).png().toFile(dir+'comparison.png')

let report=`# Door-gap GI streak - specific mechanism found; correction incomplete

**Not fixed.** This run identifies the exact calculation producing one narrow notch in the supplied floor streak. It does not establish a validated correction for the complete moving-door artefact. No production lighting code was changed.

## Reproduction

Input: Colin_house_v2.json, SHA-256 645b0d401cebe061bb36ded986607f5ec3a9413f659d5fcc5d1dbed00d20ca57. The authored file was not modified. Camera is the saved camera, FOV 45, canvas 1309 x 888. White-model display, daylight gain 3.5, ambient 0.18, clear sky, six diffuse passes, 301 probes. Full fields exclude reflection images to reduce file size, but retain all diffuse coefficients and floor/volume textures.

- [Original saved field screenshot](original.png), [field](original-field.json).
- [Door moved screenshot](moved.png), [completed field](moved-field.json), [bake measurements](moved-performance.json).
- [Fresh original screenshot](fresh-original.png), [fresh field](fresh-original-field.json), [samples](fresh-original.json).

The double-door assembly was translated -0.4 m in world X, from (1.3697619232, 0, 14.4767676465) to (0.9697619232, 0, 14.4767676465), retaining rotation Y = -pi. It was detached in the isolated fixture to retain the existing wall aperture and move the complete model. This is a free model translation, not an editor operation that also relocates its wall opening. Both completed captures report 1806/1806 transport tasks. An earlier attempt moved the neighbouring single door; it was restored before the saved double-door test and is not used as evidence.

An initial fresh-bake run used fixture defaults (gain 1, ambient 0.3). Those were corrected to the original active settings and its images/measurements were replaced. The final fresh cache retains an inactive nightAmbientTerm of 0.03 versus 0.18 in the source; daylight is enabled throughout.

## Exact notch mechanism

The affected floor mesh and triangle are established by the [previous GPU pixel audit](../render-artefacts/2026-11-03/report.md). This investigation traces the generation of its floor texels, not just their displayed values.

Probe 590 is a floor probe at (2.25, 0.1800000072, 14), room region 4. Its upward irradiance is (0.1892052, 0.1791355, 0.1751072), all positive. At Z = 15.1229996, its visibility is off/on/on/off across the four successive texels listed below. When admitted, its original compact-kernel weight is added in full and all surviving probe weights are renormalized. It gains approximately 18% of the blend and pulls a roughly 0.565 red irradiance down to 0.499. It disappears again at the next boundary, restoring approximately 0.567.

Source: src/indirectVolume.ts, createIndirectVolumeLookup's states[i] rejection and weight/total accumulation, and the matching sampleIndirectCoefficients implementation. src/indirectFloorLighting.ts:37, writeIndirectFloorRow, stores the resulting SH blend. The shader and texture filter reproduce it; they do not introduce this notch.

Exact door: placed model a05cbb5f-52ea-4231-94ef-19667bc1c609, asset portal-model-733dc6616bdca8751ed18fbc28adf04e, name **Interior double doors open**. A scoped triangle raycast identifies **Cube012_2**, triangle 1288, at the left blocked edge and **doorFrame_geo**, triangle 508, at the right blocked edge. The two intervening rays pass through the actual gap. [Mesh identities and triangle hits](door-mesh-hits.json) were measured on the translated assembly with both ray endpoints translated by the same -0.4 m, preserving the relative ray/geometry configuration. These are real leaf/frame intersections, not invented blockers.

| X (m) | Visibility of 590 | Normalized weight | Full GI R | Reference R | Support sum |
|---|---:|---:|---:|---:|---:|
`
for(const i of [3,4,5,6]){const p=original.points[i],l=p.links.find(l=>l.index===590);report+=`| ${f(p.position[0])} | ${l.visibility} | ${f(l.normalizedWeight)} | ${f(p.unfiltered[0])} | ${f(ref(p))} | ${f(p.support)} |\n`}
report+=`
All four receiver positions have Y = 0.016 m and normal (0,1,0). Confidence is 1; there is no low-support attenuation or negative reconstructed irradiance at the notch. The production any-hit BVH query and independent nearest-triangle query disagree on **${mismatch}** tested links across both lines. The recorded contribution sums reproduce the production interpolation. This rules out a normalization arithmetic error for this notch. It does not prove every BVH query or every streak in the house correct.

![Irradiance and visibility-weight comparisons](comparison.png)

## Full trace and independent comparison

[Original 17-texel trace](original-trace.json) and [moved-door 37-texel trace](moved-trace.json) include every candidate probe ID, position, distance, binary visibility weight, normalized weight, individual SH coefficients, per-probe irradiance/contribution, unclamped reconstruction, support/confidence and stored filtered irradiance. Probes outside the influence radius or invalid probes are excluded by the production sampler. The sampled line is at exact floor texel centres, so the post-filter value principally differs by half-float storage precision; arbitrary-pixel filtering was measured in the earlier audit.

Reference: independent scene-triangle diffuse path integration, original materials and textures, identical sun and active lighting conditions. Original: 16384 paths/point; moved: 8192 paths/point; six diffuse bounces. It uses no probes, volume or capture replay. Reference limitations and per-channel standard errors are in the trace JSON. It excludes secondary specular transport, emissive mesh surfaces and secondary normal-map perturbations. The plotted uncertainty combines the reported component standard errors in quadrature; it is approximate, not a confidence guarantee including model bias.

Fresh original bake has the same geometry/project/asset keys and probe layout as the saved field. Maximum RGB difference over the 17 floor samples is **${delta}**. Thus this notch is reproducible after a fresh calculation; it is not merely a stale display or saved texture.

The completed moved-door bake changes the supplementary floor-probe layout: index 590 is reassigned to (6.25,0.18,6.25), and no nearby counterpart remains at (2.25,0.18,14). The narrow original notch is absent on the measured moved line, while other irradiance discontinuities and reference error remain. Consequently, this run does **not** demonstrate a rigidly translated copy of the original streak under the same probe support. It must not be presented as a successful moving-door fix.

## Why no correction is committed

The demonstrated problem is the influence given to a valid but unrepresentative dark measurement when a single ray becomes visible through a narrow gap. A single intersection is geometrically correct, yet its binary decision permits the probe's entire low-order irradiance estimate to enter the blend with substantial weight. This establishes one notch's mechanism, but does not identify a faulty intersection or arithmetic operation that can simply be corrected.

Deleting probe 590, closing the model's real gap, changing a bias, or suppressing all cross-door probes would only hide this case or discard legitimate transport. None was applied. The unresolved calculation is a geometry-dependent influence weight that limits this narrow visibility connection while preserving valid openings and satisfying the moved/rotated-door and thin-wall requirements. A concrete candidate still needs reference-backed validation across the same doorway with a controlled probe layout and with the production layout rebuild. No such correction was demonstrated in this run. This is incomplete bug-fix work, not a claim that the visible streak is physically correct.

## Validation and performance status

Baseline command: node --test --experimental-strip-types tests/indirectFloorLighting.test.ts tests/indirectInterpolationReuse.test.ts tests/giBarrierFiltering.test.ts

**10/10 tests passed**, including the 6 mm barrier filter regression, black/weak-support handling, separate storeys, L1/L2 incremental reuse, interrupted edits and cache invalidation. These validate the unchanged baseline, not a correction to the door streak. Open/closed/rotated-door, frames, furniture legs, cabinets, stairwells, multi-angle fix regressions and incremental-versus-fresh corrected fields remain unperformed. There are no after-fix screenshots.

No production CPU/GPU memory, visibility-query count or frame-time change was introduced. Diagnostic reference tracing took ${(original.elapsedMs/1000).toFixed(2)} s for the original line and ${(moved.elapsedMs/1000).toFixed(2)} s for the moved line; these are offline investigation costs, not normal render costs. Production bake/profile counters are saved in moved-performance.json and fresh-original.json, but no correction-versus-baseline performance claim is made.

Diagnostic additions: tests/browser/doorFloorTrace.worker.ts, tests/browser/doorFloorVite.config.mjs and tests/doorFloorTraceReport.mjs. The test-only Vite configuration ignores diagnostic outputs because Windows EBUSY file-watch errors terminated the server during earlier attempts. Completed fields and traces above were retained; interrupted attempts are not used as completed-bake evidence.
`
fs.writeFileSync(dir+'report.md',report)
console.log(JSON.stringify({freshMaxDifference:delta,visibilityDisagreements:mismatch,report:dir+'report.md'}))
