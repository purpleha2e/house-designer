import { DataUtils, PerspectiveCamera, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { LumenViewportPass } from '../../src/lumenViewportPass'
import { buildLumenCache, createLumenGeometry } from '../../src/lumenSurfaceCache'
import { buildLumenDistanceField } from '../../src/lumenDistanceField'
import type { ReferenceSceneData } from '../../src/diffuseSceneMaterials'

/** An upward-facing receiver sees sky through a finite vertical opening.
 * A wall across its line of sight must remove that energy on both sides. */
export async function checkLumenAperture(distanceTracing = false) {
  const renderer=new WebGLRenderer()
  const pass=new LumenViewportPass(new PerspectiveCamera())
  const input=new WebGLRenderTarget(4,4), output=input.clone()
  const quad=(y:number)=>[-1,y,-1,-1,y,1,1,y,1,-1,y,-1,1,y,1,1,y,-1]
  const results:number[][]=[]
  try {
    for(const closed of [false,true]){
      const vertices=quad(0)
      if(closed) vertices.push(-.8,0,-2,-.8,2,-2,-.8,2,2,-.8,0,-2,-.8,2,2,-.8,0,2)
      const positions=new Float32Array(vertices)
      const data:ReferenceSceneData={positions,uvs:new Float32Array(vertices.length*2/3),
        materialIndices:new Uint16Array(vertices.length/9),textures:[],lights:[],daylightGain:1,
        skyBase:[1,1,1],skySun:[0,0,0],skyMode:'clear',sunDirection:[0,1,0],sunIrradiance:[0,0,0],
        materials:[{color:[1,1,1],map:-1,metalness:0,wrapS:1001,wrapT:1001,matrix:[1,0,0,0,1,0,0,0,1]}]}
      const geometry=createLumenGeometry(data)
      const cache=buildLumenCache(data,[0,1,0],.12,true,geometry)
      try{
        const atlas=cache.atlas
        if(distanceTracing)atlas.distanceField=buildLumenDistanceField(geometry.tree,atlas.origin,atlas.dimensions,atlas.spacing)
        pass.upload(atlas)
        pass.setDistanceTracing(distanceTracing)
        pass.setDaylight([{center:[-2,1,0],width:1,height:1,u:[0,0,1]}],new Vector3(1,1,1),new Vector3(),false)
        pass.displayMaterial.uniforms.diagnostic.value=1
        while(!pass.skyReady){pass.render(renderer,input,output);await new Promise(requestAnimationFrame)}
        let index=0,nearest=Infinity
        for(let i=0;i<atlas.count;i++){
          if(atlas.normals[i*4+1]<.99)continue
          const distance=Math.hypot(atlas.positions[i*4],atlas.positions[i*4+2])
          if(distance<nearest){index=i;nearest=distance}
        }
        if(nearest>.13)throw Error('Missing central floor receiver')
        const texel=new Uint16Array(4)
        await renderer.readRenderTargetPixelsAsync(pass.skyAtlas,index%atlas.width,Math.floor(index/atlas.width),1,1,texel)
        results.push(Array.from(texel,DataUtils.fromHalfFloat))
      }finally{cache.dispose();geometry.dispose()}
    }
    return results
  }finally{pass.dispose();input.dispose();output.dispose();renderer.dispose()}
}
