import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { lightingBrowser } from './lightingHarness.mjs'
const b = await lightingBrowser()
try {
  await b.call('Page.navigate', { url: 'http://127.0.0.1:5188/tests/browser/houseTrimFixture.html' })
  await b.wait('window.trimLab?.stats().frames>10')
  const image = Buffer.from((await b.call('Page.captureScreenshot', { format: 'png' })).data, 'base64')
  const points = await b.evaluate('trimPixels()'), samples = []
  for (const p of points) {
    const { data, info } = await sharp(image).extract({ left: p.x - 2, top: p.y - 2, width: 5, height: 5 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let sum = 0; for (let i = 0; i < data.length; i += info.channels) sum += data[i]
    samples.push(sum / 25)
  }
  assert.ok(samples[0] > 150, `lower skirting must inherit bright wall irradiance: ${samples}`)
  assert.ok(Math.abs(samples[0] - samples[1]) < 3, `uniform wall irradiance must not create a trim gradient: ${samples}`)
  assert.equal(await b.evaluate('trimLab.data.position.length/9'), 4)
  const edge = await b.evaluate(`(async()=>{
    const lab=trimLab,w=lab.data.width,h=lab.data.height,p=new Float32Array(w*h*4),n=new Float32Array(p.length);
    await lab.renderer.readRenderTargetPixelsAsync(lab.gbuffer,0,0,w,h,p,undefined,0);
    await lab.renderer.readRenderTargetPixelsAsync(lab.gbuffer,0,0,w,h,n,undefined,1);
    let minimum=Infinity,count=0;
    for(let i=0;i<p.length;i+=4)if(p[i+3]>.5&&n[i+2]>.99){minimum=Math.min(minimum,p[i+1]);count++}
    return {minimum,count};
  })()`)
  assert.ok(edge.count > 100)
  assert.ok(edge.minimum > .002 && edge.minimum < .02, `wall receivers must stay just inside the floor junction, including padding: ${JSON.stringify(edge)}`)
  assert.deepEqual(b.errors, [])
  mkdirSync('tmp/lighting-lab/trim', { recursive: true }); writeFileSync('tmp/lighting-lab/trim/receiver.png', image)
  console.log(JSON.stringify({ bottomAndTop: samples, lightingTriangles: 4, edge }))
} finally { b.close() }
