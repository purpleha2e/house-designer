import {readFileSync,writeFileSync} from 'node:fs'
const dir='tmp/viewport-fps/render-loop/final'
const a=JSON.parse(readFileSync(dir+'/audit.json','utf8')),s=JSON.parse(readFileSync(dir+'/summary.json','utf8'))
const cpu=Object.fromEntries(['still','moving'].map(mode=>[mode,JSON.parse(readFileSync(dir+'/'+mode+'-cpu.json','utf8')).profiles[0]]))
const f=(n,d=2)=>Number(n).toFixed(d),table=(headers,rows)=>['| '+headers.join(' | ')+' |','| '+headers.map(()=>'---').join(' | ')+' |',...rows.map(row=>'| '+row.join(' | ')+' |')].join('\n')
const link=(path,line)=>`[${path.split('/').at(-1)}${line?':'+line:''}](../../${path}${line?'#L'+line:''})`
const detail=s.detailed[0],moving=s.detailed[1],source=v=>link(v.source.source?.replace(/^(\.\.\/)+/,''),v.source.line)
const normal=s.normal.filter((_,i)=>i===0||i===2)
const timing=table(['Window','Display submissions per second','Main CPU ms','AO CPU ms','Output CPU ms','Composer CPU ms','Main GPU median ms','AO GPU median ms'],normal.map(r=>[r.moving?'Moving':'Still',f(r.fps),f(r.perFrame['0:RenderPass:cpuMs']),f(r.perFrame['1:Pass:cpuMs']),f(r.perFrame['2:EffectPass:cpuMs']),f(r.composer.mean),f(r.gpu.find(g=>g.pass==='0:RenderPass').median),f(r.gpu.find(g=>g.pass==='1:Pass').median)]))
const callbackTable=table(['Priority','Callback','Calls each frame','Still aggregate ms each frame','Moving aggregate ms each frame','Source'],[...detail.callbacks].sort((a,b)=>a.priority-b.priority||b.callsPerFrame-a.callsPerFrame).map(v=>[v.priority,v.source.label.replace(/\r/g,'').match(/(?:function|class)\s+(\w+)/)?.[1]??'EffectComposer guard',f(v.callsPerFrame,0),f(v.msPerFrame,3),f(moving.callbacks.find(m=>m.id===v.id)?.msPerFrame??0,3),source(v)]))
const categoryTable=table(['CPU sample category','Still percent','Moving percent'],cpu.still.categories.filter(v=>!v.name.startsWith('(')&&v.percent>=1).map(v=>[v.name,f(v.percent),f(cpu.moving.categories.find(m=>m.name===v.name)?.percent??0)]))
const groupTable=table(['Pass and object category','Still submissions each frame','Moving mean submissions each frame','Distinct materials in still window','Distinct geometries in still window'],detail.groups.sort((a,b)=>b.callsPerFrame-a.callsPerFrame).map(v=>[v.name.replace('0:RenderPass:','Main / ').replace('1:Pass:','AO / ').replace('2:EffectPass:','Output / '),f(v.callsPerFrame,0),f(moving.groups.find(m=>m.name===v.name)?.callsPerFrame??0),v.materials,v.geometries]))
const report=`# Extaplan render loop analysis

Measured on 10 November 2026 against the existing production preview. The editor spends most of each frame submitting and shading hundreds of separate objects, even when the camera is still. The 2D plan was not drawing during the measured windows. There are useful batching opportunities without reducing lighting or image quality, starting with skirting.

## Findings and priorities

1. **Skirting is split into 120 meshes, 120 geometries and 120 materials in the measured still view.** Every material has the same authored colour and settings in the current component. Merge the already clipped runs into one geometry per floor/component and use a shared material. Disconnected pieces can coexist in a geometry. Door gaps, corner mitres and roof cuts do not require separate draw calls. Merely sharing a material leaves separate mesh submissions. Room/floor visibility and geometry replacement must remain correct.
2. **Still editor frames repeat the complete compositor.** Once preparation settles, the editor has no unchanged-frame draw suppression. A still frame has 739 main submissions, 106 AO submissions and one final output submission: 846 standard native draws in total. The same count was independently obtained from renderBufferDirect dispatches. Movement changes culling and uniforms; it does not introduce a second general rendering pipeline.
3. **AO has substantial scene-management work.** Its transparency path renders the house twice more, visits the 1,262-object scene four times for visibility bookkeeping, and resubmits glass. This costs about 2.9–3.0 ms of CPU time per normal frame here, versus about 2 ms of sampled GPU time. Reducing AO sample count alone does not remove those CPU costs.
4. **There are 420 frame callbacks, but the non-render callbacks total only about 0.40 ms still and 0.45 ms moving in the instrumented census.** Removing large numbers of small callbacks would produce less benefit than reducing submissions. These callback timings include diagnostic timer overhead.
5. **Program selection, uniforms and draw dispatch dominate CPU samples.** The shared lighting-array cache avoids uploads but still compares array contents repeatedly. Revision-based invalidation could reduce that work after ownership and mutation paths are made explicit. It must not cache camera matrices or samplers blindly.

The first practical change should be skirting geometry/material consolidation, followed by repeated opaque furniture and window-frame batching. Treat idle draw suppression as a separate correctness-sensitive change. This audit did not deploy rendering changes.

## Conditions and evidence

The user closed the existing Extaplan 3D tab. Only one audit-owned Chrome ran at a time. The stopped preview and asset/workspace services were restored before loading the application. Both valid runs used the production main bundle **${s.bundle}**, SHA-256 **${s.hash}**, with matching hidden source maps. The unshipped shader-key candidate was not substituted.

The final canvas was **${a.settled.canvas.join(' × ')} physical pixels**, DPR 1; the supplied user profile was 962 × 1049. The browser window was 1924 × 1049 and the split layout occupied some width with its divider. Hardware was ${a.initial.graphics}. The same Colin project loaded both floors, 68 placements and saved lighting: 301 probes and 13 reflections. The fixed camera was at [-10, 9, -11], looking at [4, 3, 8]. The controlled movement translated it by up to 0.25 m in X/Z and rotated yaw by up to 0.15 radians. This measures camera-dependent renderer work; input handling while holding real navigation keys is described from source separately.

The audit used a temporary Chrome profile and uncapped rendering flags. These FPS numbers are **render throughput**, not a claim that a 60 Hz monitor displays more than 60 distinct frames per second. Headless scheduling, machine performance variation and the chosen camera limit comparisons with a different foreground session. This audit did not reproduce the sustained 20–25 FPS state.

Settings remained those of the served build: existing sun and cached shadows, GI/reflections, transparency, exposure/tone mapping, AO and resolution. Source settings are AO samples 6, denoise samples 3, half resolution, resolution scale 0.75. No quality option was toggled. A screenshot is saved as [view.png](../../${dir}/view.png).

There were four alternating normal timing windows (still, moving, moving, still), two separate five-second detailed windows, minimal composer-only timing windows after removing detailed wrappers, and separate CPU sampling profiles. GPU times used asynchronous timer queries, sampled every 30 display frames and ignored when disjoint. No finish, readPixels or synchronous GPU wait was used.

Normal timings retain lightweight pass/native wrappers. The detailed census reduced throughput to 51–53 FPS and must not be used as normal performance. With its wrappers removed, the minimal checks measured ${f(a.minimal[0].frames*1000/a.minimal[0].ms)} submissions/s still and ${f(a.minimal[1].frames*1000/a.minimal[1].ms)} moving, with composer means ${f(a.minimal[0].composerMs)} and ${f(a.minimal[1].composerMs)} ms respectively. These broadly agree with the normal windows.

## Normal frame timings

${timing}

The table uses the first still window and the second moving window, which had no worker traffic, texture/buffer uploads or compilation. The other moving window received one late floor-filter worker response. The final still window created one texture and issued 485 texSubImage3D uploads; it is excluded from steady-state comparisons. Its similar mean FPS does not make it a clean idle window.

CPU pass times are nested inside composer time. GPU times overlap CPU submission and browser work; CPU and GPU columns must not be added. Main plus AO GPU time being lower than the CPU composer time is consistent with a CPU submission bottleneck in this run, rather than pure pixel shading saturation. It does not identify every source of browser/driver blocking.

The moving camera culled some objects, so its slightly higher throughput is not evidence that motion intrinsically makes rendering faster. The normal still window issued 557 indexed draws, 267 array draws and 22 instanced draws per display frame. In the clean moving timing window, that sum averaged ${f(Object.values(normal[1].nativePerFrame).reduce((n,v)=>n+v,0))}. The different five-second moving census averaged 797.21, because it covered a different portion of the same trajectory.

## What executes during a frame

~~~text
Browser animation frame
  React Three Fiber loop → clock delta → subscribers in priority order
    priority -1: keyboard/gamepad controls, 68 live model transforms
    priority  0: visibility, model batches, highlights, fading guards,
                 sun/ambient/sky, status counters, AO toggle, other guards
    priority  1: SceneRenderer
      preparation and worker-state gates
      camera / selection / lighting / size / exposure change checks
      choose live or retained prepared scene
      bind optional filtered lighting textures
      EffectComposer.render
        RenderPass
          update house world matrices
          traverse/cull/sort scene and build render lists
          check cached sun-shadow caster state
          draw opaque and transparent objects
        N8AO
          detect transparency
          save visibility and filter two transparency groups
          render two transparency target scenes and restore visibility
          depth/AO/denoise/composite fullscreen work
        EffectPass
          tone mapping and final output
      restore temporary lighting bindings and renderer state
    priority  2: IndirectLighting state machine
                 poll completed work, update navigation/status/uniforms,
                 return cheaply when no lighting work is pending
~~~

Fiber's positive-priority SceneRenderer takes ownership of rendering. Fiber's default automatic gl.render is therefore disabled; the @react-three/postprocessing frame callback is also disabled by its enabled=false setting. The measured three passes execute once each per display frame, rather than two independent composers drawing the house. See ${link('src/components/SceneRenderer.tsx',77)} and ${link('src/components/ThreeDView.tsx',21855)}.

The editor Canvas uses frameloop=always unless suspended by its existing modal state. ${link('src/sceneRenderSchedule.ts',5)} suppresses unchanged frames for static published tours, geometry preparation and certain background lighting states. A settled editable view falls through to normal drawing every frame. Calling invalidate less often would not by itself stop an always-running editor.

### Changes while moving

Keyboard controls return immediately when no movement keys are held. Real navigation applies clamped input delta, camera translation, collision/step logic where enabled, and pointer-look event changes. In the controlled motion windows, the audit changed only the camera pose, so expensive key-driven collision queries are not included in their measured delta.

Camera movement invalidates horizontal-surface visibility checks, updates culling and model-view matrices, changes view-dependent uniforms, and marks navigation for about 200 ms. The horizontal-surface controller rose from effectively zero when still to about 0.041 ms each frame in the detailed moving window. GI work is deferred while navigating. Camera state is checked at 10 Hz and published only when changed; local-light selection is checked at 0.25-second intervals after enough camera translation. This does not switch the selected 2D floor.

Fading hooks return early when disabled or when the camera/view has not changed. Their presence in the callback list does not imply a full geometry scan 258 times per frame. XR controls and FastGI guards are also mounted but return early in this desktop configuration.

## Render passes and scene walks

The main pass updates 1,263 Object3D nodes per frame, including the scene/camera boundary. These are recursive method-entry counts, not 1,263 independent root traversals or geometry rebuilds. It submits 658 opaque and 81 transparent draws in the fixed still pose. Transparent double-sided materials can produce more than one draw per object.

The sun-shadow path calls traverse 1,262 times and traverseVisible 1,258 times per main frame, principally the blocker and cached caster-state checks. **No native draws were issued while the shadow dispatch wrapper was active in either detailed window.** Cached depth maps were being reused. The CPU still compares caster transforms, geometry/material state and visibility. Camera-only movement in this configuration does not regenerate the whole-building shadow map. See ${link('src/sunShadowCache.ts',77)} and ${link('src/components/ThreeDView.tsx',15471)}.

AO records **5,048 recursive traverse entries per frame**, exactly four walks of the 1,262-object scene for transparency visibility management. Transparency detection may short-circuit after finding a transparent material; those counts are distinct from the four complete walks. Its 106 still submissions comprise 82 transparent-material submissions, 16 scene submissions using opaque materials, and eight fullscreen/helper submissions. The opaque-material scene submissions are 15 wall-engine groups and one ceiling slab; their exact inclusion in the transparency targets needs a focused visibility/material audit before changing that path.

${link('src/ambientOcclusionResources.ts',27)} already disables repeated house world-matrix updates and shadow updates during AO transparency rendering. The audit confirms there is no second full 1,263-node transform update for each of those two draws. Further optimization should preserve that fix and preserve glass/depth composition.

The final EffectPass submits one fullscreen draw and costs only about 0.03 ms of CPU time. It is a low-priority optimization target.

## Draw submission and batching

The fixed still view has 329 opaque model submissions, including 117 custom-window frame submissions. In addition, 22 native instanced draws show that imported-model batching already works. Most wall geometry is already grouped: the wall engine contributes 15 main material-group draws across two geometries, rather than one draw per wall segment.

Skirting is the clearest unbatched generated geometry. ${link('src/components/ThreeDView.tsx',6437)} builds a geometry per clipped run. ${link('src/components/ThreeDView.tsx',6455)} then maps each geometry to a mesh containing a fresh meshStandardMaterial with colour #f8fafc, flat shading and roughness 0.58. The current render grouping preserves edit-derived pieces but has no requirement for one GPU object per run. Merge within each floor/component without creating material groups per original run. If all 120 visible runs could be replaced by two floor meshes, the theoretical reduction is 118 submissions, about 14% of this frame's draws. That is a draw-count bound, not a promised 14% FPS improvement.

Eight base cabinets contribute 32 draws using four geometries and four materials; instancing those compatible placements could reduce that family to four draws before culling effects. Four beds, three sofas, two sink units and two toilets bring the earlier CPU-only inventory's additional ordinary-furniture upper bound to 35 primitive submissions. Current eligibility requires wallMount and no material overrides, so these ordinary furnishings bypass the existing instancer. See ${link('src/components/ThreeDView.tsx',13230)} and ${link('src/importedModelBatching.ts',38)}.

The current project has **16 custom-window placements across six definitions**. Their opaque frame parts contribute 117 main submissions in the audited pose. Each placement currently builds its own geometry. Instancing needs shared compatible geometry and dimensions, or merged static frame geometry with correct UVs/normals; scaling a whole finished window indiscriminately could change frame thickness. Glass must retain transparency ordering and AO handling. The runtime inventory supersedes earlier preliminary counts of custom windows.

There are also 46 roof-infill draws, 29 floor-finish draws and 20 floor-base draws. These should be considered after skirting and repeated furniture. Batch by compatible finish, attributes, clipping, render order and visibility; preserve semantic pick/collision objects separately. Existing door batching is partial: 52 unbatched opaque interior-door submissions remain alongside the instanced groups. Repeated asset names alone do not prove shared runtime geometry/material identity or eligibility.

## Programs and uniforms

The detailed still frame made 188 useProgram calls and 257 bindTexture calls across all three passes. The program count stayed at 70 through the final run. A program count describes cached shader variants, not draw count or compilations happening every frame. The clean timing windows recorded no compileShader, linkProgram, getActiveUniform, bufferData or bufferSubData calls and no texture uploads.

The detailed still window issued 926 uniformMatrix4fv and 225 uniformMatrix3fv calls per frame across main and AO passes. Moving changed additional uniforms: main uniform3f calls rose from 90 to about 392. Per-object model-view transforms, normals, camera/light state and texture slots make separate submissions expensive even for modest meshes. Combining geometry/material-compatible objects reduces those repeated paths.

Material customProgramCacheKey was called 34 times per displayed still frame inside the compositor, taking about 0.54 ms under detailed timers, plus about 11 calls per displayed frame amortized from background scanning. These inclusive timers are not extra time to add to pass CPU costs. Source-mapped profiles assign about 1.5–1.7% of samples specifically to key construction in this run, considerably less than program selection and uniform handling. The unshipped key-string cache candidate remains a smaller opportunity, not the primary explanation for the draw cost.

${link('src/rendererUniformArrays.ts',61)} caches selected shared numerical arrays per linked-program uniform. Its comparison path still accounts for about 6–7% of CPU samples. Replacing repeated content comparisons with revisions would require every producer to publish reliable mutation revisions and correct handling of program relinking, context restoration, shared material hooks and A/B/A value changes. Removing the comparison without those guarantees would produce stale lighting.

${link('src/rendererAttributeDefaults.ts',43)} repairs missing generic vertex attributes at draw time. Its own work accounts for about 4% of samples here. The much larger inclusive time below its renderBufferDirect wrapper belongs mostly to Three's draw work, not to the repair itself. Preserve the correctness fix while considering a narrower per-program/per-geometry attribute plan later.

## CPU sampling attribution

${categoryTable}

These categories partition sampled stacks using the existing analyzer; they are not independently timed additive stages. Sampled wall time can include native/browser blocking. The profiles ran after detailed prototype/material/callback wrappers had been removed. Minimal composer timing and inactive preload guards remained. Unattributed program/native samples are retained, and application-frame work is a broad residual category, not a precise component budget.

SceneRenderer/composer appear on about ${f(cpu.still.inclusive.find(v=>v.name.includes('SceneRenderer.tsx:77'))?.percent??0)}% of the still profile's stacks and ${f(cpu.moving.inclusive.find(v=>v.name.includes('SceneRenderer.tsx:77'))?.percent??0)}% moving. Generic-attribute wrapper inclusive time must not be mistaken for self time. Profiles do not justify translating every category percentage into an equivalent FPS gain.

## Activity outside the main draw

The main-thread Canvas2D drawImage, fill, stroke, fillRect, strokeRect, clearRect and text drawing counters recorded **zero calls** in all six final windows, while the 2D plan remained mounted and visible. Only the main viewport WebGL context submitted draws. The other created WebGL contexts were disconnected startup/preview contexts and had no measured draw activity. This is direct evidence against the adjacent 2D view being the steady-state render bottleneck in this comparison; 2D edits and gestures have separate costs.

React commit deltas were zero in the clean main timing windows. CPU profiles did not show a material floorplan/reconciliation workload. DOM status formatting and the mounted FPS/stat callbacks still run. The FPS/stat sampling code uses roughly 0.35-second intervals, and camera persistence checks use 0.1 seconds. These periodic callbacks are small compared with submission.

Shader/resource discovery continues in the background. ${link('src/viewportScan.ts',3)} schedules cooperative scans about 500 ms after the previous scan completes, while RoomLightMaskController scans scene materials every 0.25 seconds. That explains some background traversals and key calls even with no edits. These are discovery/comparison scans, not continuous shader compilation or model loading.

GI was loaded from saved data and capturedFaces stayed zero; worker traffic was absent in the clean windows. One soft-floor filter worker replied during the first moving window. Its texture was published later when navigation stopped: one texture creation, 485 3D subimage calls, textures 110 → 111, programs/geometries unchanged. The GI-ready badge alone therefore does not guarantee that optional floor filtering and publication have finished. Source ${link('src/components/SoftFloorGI.tsx',52)} plus ${link('src/viewportScheduling.ts',49)} explains deferred work during navigation. It is not evidence of continuous rebaking.

The old main-thread-stall detector also needs visibility-aware interpretation: animation-frame gaps while a tab is hidden or suspended can be logged as stalls. Such a gap does not by itself prove a long JavaScript task. No machine power settings were changed for this audit.

## Optimization experiments in order

| Experiment | Expected effect | Required checks |
| --- | --- | --- |
| Merge skirting runs per floor/component and share material | Remove most of 120 separate draws and material objects | Door gaps, corner mitres, gable/roof cuts, visible rooms/floors, wireframe, regeneration/disposal |
| Add compatible ordinary furniture to existing instancing | Reduce repeated cabinet/bed/sofa submissions | Picking, selection, live transforms, nonuniform/mirrored transforms, overrides, shadows, GI source hierarchy |
| Share or merge opaque window-frame geometry | Reduce 117 opaque frame draws where compatible | Exact frame dimensions, UVs, glass sorting, object editing and cross-floor selection |
| Narrow AO transparency traversal to tracked renderable lists | Reduce four full visibility walks and repeated render-list work | Add/remove/edit, arrays of materials, original visibility, retained scenes, depth-writing glass, opaque items observed in AO |
| Add settled editor draw suppression | Avoid 846 repeated draws while unchanged | Wake immediately for camera/input, edits, selection, resizing, lighting/texture publication, context restoration, XR and animation |
| Replace selected shared-array content checks with explicit revisions | Reduce repeated CPU comparisons | Track all mutations per producer/program/context; preserve A/B/A and failed-upload retry |
| Narrow shader/resource fallback polling and attribute plans | Reduce residual background scans/setup | Preserve late-loaded resources, unknown custom hooks, failure recovery and default attributes |

Batching and idle suppression solve different problems. Batching helps while moving and while editing. Idle suppression mainly reduces unnecessary CPU/GPU load and can improve thermal headroom; an idle view that submits no new frames should display an idle status rather than misleadingly advertise zero rendering FPS. No FPS improvement is claimed until a before/after comparison with unchanged quality has passed.

## Complete frame callback census

All 420 original subscriptions were covered every frame in both detailed windows. The probe reattaches when React replaces a callback ref, avoiding the coverage loss in the earlier one-shot profiler. Tiny timer values are quantized; aggregate costs are more useful than any individual microsecond figure. Source positions are resolved from exact callback text in the served bundle and its matching map.

${callbackTable}

## Complete submission census

These are renderBufferDirect submissions grouped by pass, semantic parent/role and material transparency. Transparent objects can appear in the main pass and again in AO. Per-row distinct material and geometry counts are scoped to that row, so they must not be summed as global resource totals. Moving values are averages over the five-second census trajectory, rather than the ten-second normal timing trajectory.

${groupTable}

## Reproduction and retained artifacts

- Runner: ${link('tests/browser/renderLoopAudit.mjs')}; injected probe: ${link('tests/browser/renderLoopAuditProbe.mjs')}.
- Summary mapper: ${link('tests/summarizeRenderLoopAudit.mjs')}; CPU parser: ${link('tests/analyseViewportCpuTrace.mjs')}.
- Raw bounded measurements: [audit.json](../../${dir}/audit.json); mapped [summary.json](../../${dir}/summary.json).
- Chrome CPU profiles: [still.cpuprofile](../../${dir}/still.cpuprofile), [moving.cpuprofile](../../${dir}/moving.cpuprofile). Keep them as files; do not paste the raw profiles into chat.
- Parsed CPU reports: [still-cpu.json](../../${dir}/still-cpu.json), [moving-cpu.json](../../${dir}/moving-cpu.json).
- Earlier narrower-camera exploratory run is under the parent render-loop directory. It is not mixed into the final tables.

All audit-owned Chrome instances were closed in their runner's finally block. The normal preview and supporting services remain running. The production application source and dist were not rebuilt or deployed during this audit. The authored project files were not edited.
`
writeFileSync('docs/selection-recovery/RENDER_LOOP_ANALYSIS.md',report)
console.log('Wrote docs/selection-recovery/RENDER_LOOP_ANALYSIS.md')
