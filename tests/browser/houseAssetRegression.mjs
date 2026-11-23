import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
import assert from 'node:assert/strict'
const out='tmp/lighting-lab/assets';mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),report={}
try {
 for(const asset of ['frame','window','sofa','corner']) {
  await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/houseAssetFixture.html?asset='+asset+(process.env.ASSET_BASELINE?'&baseline':'' )})
  await b.wait('window.assetLab?.stats().frames>360')
  report[asset]=await b.evaluate(`(async()=>{
    const lab=assetLab,d=lab.data,pixels=new Float32Array(d.width*d.height*4);
    await lab.renderer.readRenderTargetPixelsAsync(lab.gbuffer,0,0,d.width,d.height,pixels);
    let missing=0,wrong=0,total=0,degenerate=0;const errors=[],missingTriangles=[];
    for(let t=0;t<d.position.length/9;t++){
      const a=[...d.position.slice(t*9,t*9+3)],ab=[0,1,2].map(i=>d.position[t*9+3+i]-a[i]),ac=[0,1,2].map(i=>d.position[t*9+6+i]-a[i]);
      const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
      // Imported assets contain effectively collinear faces. A sub-10-micron
      // altitude cannot be a meaningful visible lighting receiver.
      if(Math.hypot(...cross)/Math.max(Math.hypot(...ab),Math.hypot(...ac),1e-12)<1e-5){degenerate++;continue;}
      const point=[0,0,0],uv=[0,0];for(let v=0;v<3;v++){for(let axis=0;axis<3;axis++)point[axis]+=d.position[t*9+v*3+axis]/3;for(let axis=0;axis<2;axis++)uv[axis]+=d.chart[t*6+v*2+axis]/3;}
      const x=uv[0]-.5,y=uv[1]-.5,bx=Math.floor(x),by=Math.floor(y),fx=x-bx,fy=y-by,s=[0,0,0,0];
      for(let j=0;j<2;j++)for(let i=0;i<2;i++){const at=((by+j)*d.width+bx+i)*4,w=(i?fx:1-fx)*(j?fy:1-fy);for(let k=0;k<4;k++)s[k]+=pixels[at+k]*w;}
      total++;if(s[3]<.001){missing++;missingTriangles.push({triangle:t,position:[...d.position.slice(t*9,t*9+9)],chart:[...d.chart.slice(t*6,t*6+6)]});continue;}const error=Math.hypot(...point.map((v,k)=>v-s[k]/s[3]));if(error>.1)wrong++;errors.push(error);
    }
    errors.sort((a,b)=>a-b);return{stats:lab.stats(),missing,wrong,total,degenerate,missingTriangles,positionErrorP95:errors[Math.floor(errors.length*.95)]};
  })()`)
  writeFileSync(out+'/'+asset+'.png',Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  writeFileSync(out+'/report.json',JSON.stringify({...report,errors:b.errors},null,2))
 }
 if(!process.env.ASSET_BASELINE){
  for(const [asset,result] of Object.entries(report))assert.equal(result.missing,0,asset+' must have capture coverage')
  assert.ok(report.corner.positionErrorP95<.05,'Curved upholstery must not sample distant surfaces at capture borders')
  assert.ok(report.sofa.positionErrorP95<.05,'The complete sofa mesh must not reuse a different cushion or back face')
  assert.ok(report.frame.positionErrorP95<.05,'Thin frame rebates must not sample the opposite end of a moulding')
  assert.deepEqual(b.errors,[])
 }
 console.log(JSON.stringify(report))
}finally{b.close()}
