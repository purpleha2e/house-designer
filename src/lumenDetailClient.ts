import { BufferAttribute, InstancedMesh, Matrix4, type Mesh, type BufferGeometry } from 'three'

type Entry={position:BufferAttribute; version:string; indices:Uint32Array|null}
/** Snapshot preparation requests ranges serially. Cloning these buffers for
 * the worker keeps all arrays used by rendering and picking under Three's ownership. */
export function createLumenDetailClient(){
  const entries=new WeakMap<BufferGeometry,Map<string,Entry>>()
  let worker:Worker|undefined, finish:((v:Uint32Array|null)=>void)|undefined
  let lastGeometry=''
  const local=new Matrix4(),world=new Matrix4()
  async function indices(mesh:Mesh,start:number,count:number){
    if(count<768 || mesh.morphTargetInfluences || 'isSkinnedMesh' in mesh)return null
    const geo=mesh.geometry,p=geo.attributes.position
    if(!(p instanceof BufferAttribute) || !(p.array instanceof Float32Array) || p.itemSize!==3 || p.normalized)return null
    const channels=Object.entries(geo.attributes).filter(([name])=>/^uv\d*$/.test(name)).map(([,attribute])=>attribute)
    if(channels.some(a=>!(a instanceof BufferAttribute) || !(a.array instanceof Float32Array) || a.itemSize!==2))return null
    const uv=channels as BufferAttribute[]
    let scale=mesh.matrixWorld.getMaxScaleOnAxis()
    if(mesh instanceof InstancedMesh){
      scale=0
      for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,local);scale=Math.max(scale,world.multiplyMatrices(mesh.matrixWorld,local).getMaxScaleOnAxis())}
    }
    if(!(scale>0))return null
    const bucket=2**Math.ceil(Math.log2(scale))
    const key=[start,count,bucket].join('/'), version=[p.id,p.version,geo.index?.id,geo.index?.version,...uv.flatMap(a=>[a.id,a.version])].join('/')
    let ranges=entries.get(geo)
    if(!ranges){ranges=new Map();entries.set(geo,ranges)}
    const previous=ranges.get(key)
    if(previous?.position===p && previous.version===version)return previous.indices
    worker??=new Worker(new URL('./lumenDetail.worker.ts',import.meta.url),{type:'module'})
    const sourceKey=geo.id+'/'+version
    const currentWorker=worker
    const reduced=await new Promise<Uint32Array|null>(resolve=>{
      finish=resolve
      currentWorker.onmessage=e=>resolve(e.data)
      currentWorker.onerror=()=>{lastGeometry='';resolve(null)}
      const geometry=lastGeometry===sourceKey?undefined:{positions:p.array,index:geo.index?.array,uvChannels:uv.map(a=>a.array)}
      currentWorker.postMessage({geometry,start,count,error:.003/bucket})
      lastGeometry=sourceKey
    })
    if(worker===currentWorker){finish=undefined;ranges.set(key,{position:p,version,indices:reduced})}
    return reduced
  }
  return {indices,dispose(){worker?.terminate();worker=undefined;lastGeometry='';finish?.(null);finish=undefined}}
}
