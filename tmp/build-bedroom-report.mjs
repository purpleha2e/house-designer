import {readFileSync,writeFileSync,copyFileSync} from 'node:fs'
const out='docs/lighting-refinement',source='tmp/room-exposure-house'
const status=JSON.parse(readFileSync(`${source}/status.json`,'utf8'))
if(status.stage!=='passed')throw Error('House exposure test has not passed')
const measurements=JSON.parse(readFileSync('tmp/bedroom-daylight-audit/measurements.json','utf8'))
for(const name of ['bedroom-manual','bedroom-adapted','landing-manual','landing-adapted'])copyFileSync(`${source}/${name}.png`,`${out}/${name}.png`)
copyFileSync(`${source}/status.json`,`${out}/room-exposure-status.json`)
copyFileSync('tmp/bedroom-daylight-audit/measurements.json',`${out}/bedroom-measurements.json`)
copyFileSync('tmp/refinement-worker/results.json',`${out}/worker-progress-results.json`)
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length
const rows=measurements.probes.map((p,i)=>{
 const r=measurements.reference.results[i].reference,ref=mean(r.sky.map((v,c)=>v+r.reflected[c]))
 const probe=mean(p.inspection.displayed.rgb),exact=mean(p.inspection.exactAtSurface.rgb)
 const label=['Upper wall','Right wall','Wardrobe-facing sample','Lower surface (not floor)','Window-side surface'][i]
 return `<tr><td>${label}</td><td>${probe.toFixed(4)}</td><td>${exact.toFixed(4)}</td><td>${ref.toFixed(4)}</td><td>${((probe/ref-1)*100).toFixed(0)}%</td></tr>`
}).join('')
const figure=(name,label)=>`<figure><img src="${name}.png" alt="${label}"><figcaption>${label}</figcaption></figure>`
writeFileSync(`${out}/bedroom.html`,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Bedroom daylight and exposure</title>
<style>body{font:16px/1.5 system-ui;max-width:1400px;margin:auto;padding:24px;background:#15191e;color:#e8edf3}p{max-width:1000px}a{color:#9ad7ff}.gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0}img{width:100%}figcaption{padding:10px}td,th{text-align:left;padding:8px 16px;border-bottom:1px solid #48515b}@media(max-width:700px){.gallery{grid-template-columns:1fr}}</style>
<h1>Bedroom daylight and exposure</h1><p>The rear-left bedroom window is open to sky in all three tested aperture directions. On the two sampled main wall points, exact probe sampling is about 6–12% above independent diffuse path integration. The displayed volume interpolation is about 26% and 12% above the reference respectively: there is no general deficit of bounced light on these wall samples. That does not establish absolute photometric calibration: both use the current sky and material model. Samples around furniture differ more, including an underestimate near the window side.</p>
<p>Reference: 2,048 samples, six surface encounters, diffuse transport with textured albedo, no probe reuse. Monte Carlo uncertainty is appreciable (roughly 10% at the upper wall). These measurements use the daylight-only Springfield fixture, ambient 0, and an approximate bedroom camera, not an exact recreation of the user's lamps-on screenshots. Values below are mean linear RGB irradiance, before receiver albedo and exposure. <a href="bedroom-measurements.json">Raw measurements</a>.</p>
<table><tr><th>Measured surface</th><th>Displayed probes</th><th>Exact probes</th><th>Reference sky + bounce</th><th>Display difference</th></tr>${rows}</table>
<h2>Bounded room exposure</h2><p>The optional <strong>Adapt exposure to room</strong> checkbox meters the existing linear image on the GPU, before exposure and ACES tone mapping. It uses a centre-weighted log average and smoothly adds 0–2 EV above the manual exposure. Returning to a brighter view reduces that addition faster. It adds no ambient light and does not recapture GI. It is off initially, saved on this device, and independent of the tracing quality. The preset preserves this choice. Disable it for fixed-exposure comparisons.</p>
<p>Both comparisons below use 0 EV, identical daylight-only GI, and Fast refinement to isolate exposure. They use a wider bedroom camera than the measurement audit so the wardrobe fits in view. The adaptation brightens the whole view: it is not local tone mapping or a fix for missing light transport.</p>
<div class="gallery">${figure('bedroom-manual','Bedroom: manual 0 EV')}${figure('bedroom-adapted','Bedroom: 0 EV plus room adaptation')}${figure('landing-manual','Landing: manual 0 EV')}${figure('landing-adapted','Landing: 0 EV plus room adaptation')}</div>
<h2>Refinement responsiveness</h2><p>The worker now skips disabled lamps, avoids albedo texture reads for opaque shadow rays, reports elapsed progress within rows, yields between small sample batches, and publishes a 32-pixel coarse view before full resolution. Progressive passes start at four samples, then 16, 32, 64 and 128 as applicable. The UI distinguishes GI readiness from surface-refinement progress.</p>
<p>Validation: 31 focused transport/filter tests; real-WebGL bounded exposure, bright-view recovery, black preservation and manual restoration; house UI toggle, unchanged GI generation/captured-face counts, and no new browser errors. Worker tests exercise all three sampling budgets on a bounded fixture, plus a 128-pixel Ultra request through the coarse preview and cancellation. These are not whole-house Ultra timing measurements. <a href="room-exposure-status.json">House test</a>; <a href="worker-progress-results.json">worker test</a>.</p></html>`)
for(const file of [`${out}/report.html`,'tmp/build-refinement-report.mjs']){
 let text=readFileSync(file,'utf8')
 text=text.replace('Samples publish progressively at 16, 32, 64 and 128 as applicable.', 'A 32-pixel coarse preview appears first; full-resolution samples publish progressively at 4, 16, 32, 64 and 128 as applicable.')
 if(!text.includes('Bedroom daylight and exposure</a>'))text=text.replace('<h1>Progressive diffuse lighting</h1>','<h1>Progressive diffuse lighting</h1><p><a href="bedroom.html">Bedroom daylight and exposure</a>: later measurements, optional room adaptation, and worker responsiveness fixes.</p>')
 writeFileSync(file,text)
}
console.log(`${out}/bedroom.html`)
