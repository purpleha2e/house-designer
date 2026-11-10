import {DataUtils} from 'three'
import {sunlitReplay} from './sunlitBounceReplay'
/** Source-only display diagnostics. Exterior sky uses the production analytic
 * boundary integral; geometry, albedo and all six transport passes are shared. */
export async function sunlitSky(s:any,source:any,points:any[]){
 const d=source.cacheData,base=source.u.hdSkyRadianceBase.value.toArray(),ground=source.u.hdSkySunIrradiance.value.toArray(),overcast=source.u.hdSkyMode.value>1.5,sky=new Uint16Array(d.baseline.length),sun=new Uint16Array(d.baseline.length),zero=new Uint16Array(d.baseline.length),from=DataUtils.fromHalfFloat,to=DataUtils.toHalfFloat
 for(const tile of d.tiles)for(let f=0;f<6;f++)for(let y=0;y<d.size;y++)for(let x=0;x<d.size;x++){
  const o=((tile.faces[f][1]+y)*d.width+tile.faces[f][0]+x)*4,ny=d.normal[o+1],exterior=d.receiver[o+3]<.5&&ny>=-.01,empty=from(d.material[o+3])<.5,col=(x+.5)/d.size*2-1,row=1-(y+.5)/d.size*2,dy=(f===2?1:f===3?-1:row)/Math.hypot(1,col,row),a=overcast?.5:.6,b=overcast?1:.8,g=overcast?7/6:17/15
  for(let c=0;c<3;c++){
   let sk=0,gr=0
   if(empty){sk=base[c]*(dy>=0?a+b*dy:.2*g);gr=dy<0?ground[c]*.2/Math.PI:0}
   else if(exterior){const n=Math.max(-1,Math.min(1,ny)),product=2/3*(Math.sqrt(Math.max(0,1-n*n))+(Math.PI-Math.acos(n))*n),rhoPi=from(d.response[o+c]);sk=rhoPi*base[c]*(a*Math.PI*(1+n)*.5+b*product+.2*g*Math.PI*(1-n)*.5);gr=rhoPi*ground[c]*.1*(1-n)}
   sky[o+c]=to(sk);sun[o+c]=to(from(d.solar[o+c])+gr)
  }sky[o+3]=sun[o+3]=d.baseline[o+3]
 }
 await source.save('source-sky-sun.bin.gz',{sky,sun})
 const result:any={};for(const [name,baseline]of [['sky-only',sky],['sun-only',sun]]as const){const temporary={...source,cacheData:{...d,baseline,solar:zero}},r=await sunlitReplay(s,temporary,points,[[name,0]]);result[name]=r}
 // The replay restores its supplied base. Restore the actual source atlas too.
 const restore=await sunlitReplay(s,source,points,[]);restore.dispose();return result
}
