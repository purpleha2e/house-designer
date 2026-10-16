import { BatchedMesh, BufferGeometry, InstancedMesh, Object3D, Source, Texture } from 'three'

/** Keep prepared vertices shared while owning copied instance state. */
export function cloneViewportObject<T extends Object3D>(source: T) {
  const object=source.clone(false) as T
  if(object instanceof BatchedMesh && source instanceof BatchedMesh && object.geometry!==source.geometry) {
    object.geometry.dispose();object.geometry=source.geometry
  }
  if(object instanceof BatchedMesh || object instanceof InstancedMesh) {
    // Some Three copy paths leave an optional instance-colour texture null.
    const values=object as unknown as Record<string,unknown>
    for(const [key,value] of Object.entries(source)) if(value instanceof Texture && !(values[key] instanceof Texture))
      values[key]=value.clone()
    // Texture.clone shares Source. Detach instance pixels before the live mesh
    // moves; its copied shader variants must not upload another vertex store.
    for(const value of Object.values(object)) if(value instanceof Texture) {
      const data=value.image as { data?: { slice:()=>unknown } }
      if(data?.data?.slice){value.source=new Source({...data,data:data.data.slice()});value.needsUpdate=true}
    }
  }
  let disposed=false
  return {object,dispose(){
    if(disposed)return
    disposed=true
    if(object instanceof BatchedMesh) {
      const shared=object.geometry;object.geometry=new BufferGeometry();object.dispose();object.geometry=shared
    } else if(object instanceof InstancedMesh)object.dispose()
  }}
}
