import assert from 'node:assert/strict'
import sharp from 'sharp'
import { lightingBrowser } from './lightingHarness.mjs'
const b = await lightingBrowser()
try {
  await b.call('Page.navigate', { url: 'http://127.0.0.1:5188/tests/browser/houseDirectFixture.html' })
  await b.wait('window.directLab?.stats().frames>60')
  const pixel = async () => {
    const image = Buffer.from((await b.call('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    const {data,info}=await sharp(image).extract({ left: 125, top: 125, width: 5, height: 5 }).removeAlpha().raw().toBuffer({resolveWithObject:true})
    return [0,1,2].map(channel=>{let sum=0;for(let i=channel;i<data.length;i+=info.channels)sum+=data[i];return sum/(info.width*info.height)})
  }
  const front = await pixel()
  await b.evaluate(`(()=>{const lab=directLab,gl=lab.renderer.getContext(),link=gl.linkProgram;window.links=0;gl.linkProgram=function(...args){links++;return link.apply(this,args)};const normal=lab.displayGeometry.getAttribute('normal');for(let i=0;i<normal.count;i++)normal.setXYZ(i,1,0,0);normal.needsUpdate=true})()`)
  const frame = await b.evaluate('directLab.stats().frames'); await b.wait(`directLab.stats().frames>${frame+3}`)
  const grazing = await pixel()
  assert.ok(front[0] > 80, 'front-facing detail must receive direct light')
  assert.ok(grazing[0] < front[0] * .2, `direct shading must follow visible normals: front ${front}, grazing ${grazing}`)
  assert.equal(await b.evaluate('links'), 0); assert.deepEqual(b.errors, [])
  // A shadow boundary across packed slots 0 and 16 must interpolate decoded
  // visibility. Filtering the integer masks themselves invents other lamps.
  await b.evaluate(`(async()=>{
    const {DataTexture,FloatType,RGBAFormat,NearestFilter,NoToneMapping}=await import('/node_modules/three/build/three.module.js');
    const lab=directLab,normal=lab.displayGeometry.getAttribute('normal');
    for(let i=0;i<normal.count;i++)normal.setXYZ(i,0,0,1);normal.needsUpdate=true;
    lab.renderer.toneMapping=NoToneMapping;
    lab.setInput({daylight:false,sunDirection:[0,0,1],sunColour:[0,0,0],lights:Array.from({length:17},(_,i)=>({
      kind:'point',position:[0,0,2],target:[0,0,0],color:i===0?'#ff0000':i===16?'#00ff00':'#0000ff',power:i===0||i===1||i===16?90:0,distance:0,falloff:2,angle:1,penumbra:0}))});
    lab.step=()=>{};
    const {width,height}=lab.data,data=new Float32Array(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4;data[at]=x<8?1:0;data[at+1]=x>=8?1:0;data[at+3]=1;}
    const texture=new DataTexture(data,width,height,RGBAFormat,FloatType);texture.minFilter=texture.magFilter=NearestFilter;texture.needsUpdate=true;
    lab.uniforms.visibilityCache.value=texture;window.shadowTestTexture=texture;
  })()`)
  const shadowFrame=await b.evaluate('directLab.stats().frames');await b.wait(`directLab.stats().frames>${shadowFrame+3}`)
  const screenshot=Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64')
  const {data:row,info}=await sharp(screenshot).extract({left:110,top:128,width:36,height:1}).removeAlpha().raw().toBuffer({resolveWithObject:true})
  const samples=Array.from({length:info.width},(_,i)=>[...row.subarray(i*3,i*3+3)])
  assert.ok(samples.filter(([r,g])=>r>30&&g>30).length>=4,'Lamp shadow boundary must blend over multiple pixels')
  assert.ok(samples.every(([, ,blue])=>blue<3),'Packed shadow reconstruction must not invent another light')
  for(let i=1;i<samples.length;i++)for(let c=0;c<2;c++)assert.ok(Math.abs(samples[i][c]-samples[i-1][c])<65,'No nearest-texel shadow steps')
  assert.deepEqual(b.errors,[])
  await b.evaluate('shadowTestTexture.dispose()')
  console.log(JSON.stringify({ front, grazing, shadowBoundary:samples, shaderLinks: 0 }))
} finally { b.close() }
