import {Box3, InterleavedBuffer, InterleavedBufferAttribute, Matrix4, Vector3} from 'three'
import type {IndirectGeometrySnapshot} from './indirectVisibility.ts'

/** Worker-only identities and footprints. Unchanged parts need no new bounds.
 * Include transforms and opaque ranges so moved doors and material changes
 * invalidate visibility, even when their vertex buffers are unchanged. */
export async function softGIGeometryParts(parts:IndirectGeometrySnapshot) {
  const hashes=new Map<ArrayBufferView,Promise<string>>()
  const hash=(array:ArrayBufferView)=>{
    let result=hashes.get(array)
    if(!result){result=crypto.subtle.digest('SHA-256',new Uint8Array(array.buffer,array.byteOffset,array.byteLength).slice()).then(bytes=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join(''));hashes.set(array,result)}
    return result
  }
  const result=new Map<string,{part:IndirectGeometrySnapshot[number];bounds?:Box3}>()
  for(const part of parts){const key=JSON.stringify([await hash(part.position),part.index?await hash(part.index):null,part.stride,part.offset,part.normalized,part.ranges,part.matrices]);result.set(key,{part})}
  return result
}

export function softGIChangedBounds(previous:Awaited<ReturnType<typeof softGIGeometryParts>>,next:Awaited<ReturnType<typeof softGIGeometryParts>>) {
  const changed=new Box3(),point=new Vector3(),matrix=new Matrix4()
  const include=(entry:{part:IndirectGeometrySnapshot[number];bounds?:Box3})=>{
    if(!entry.bounds){const box=new Box3(),p=entry.part,attribute=new InterleavedBufferAttribute(new InterleavedBuffer(p.position,p.stride),3,p.offset,p.normalized)
      for(const transform of p.matrices){matrix.fromArray(transform)
        for(const range of p.ranges)for(let i=range.start;i<range.start+range.count;i++){
          const vertex=p.index?p.index[i]:i
          point.fromBufferAttribute(attribute,vertex).applyMatrix4(matrix);box.expandByPoint(point)
        }
      }
      entry.bounds=box
    }
    changed.union(entry.bounds)
  }
  for(const [key,entry] of previous)if(!next.has(key))include(entry)
  for(const [key,entry] of next)if(!previous.has(key))include(entry)
  return changed
}
