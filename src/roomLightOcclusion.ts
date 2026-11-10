import { Vector3 } from 'three'
import { createIndirectVisibilityFromSnapshot, indirectOctDirection, type IndirectGeometrySnapshot } from './indirectVisibility.ts'

export type RoomOcclusionLight = { id: string; position: number[] }
export type RoomLightOcclusion = { records: Float32Array; lights: RoomOcclusionLight[]; size: number; triangles: number }

/** Candidate silhouettes for rays crossing storeys. Exact triangle tests in the
 * shader keep the raster grid from projecting stair-opening shapes onto walls.
 * Records share the existing room/portal texture, requiring no extra sampler. */
export function buildRoomLightOcclusion(geometry: IndirectGeometrySnapshot, lights: RoomOcclusionLight[], size = 128): RoomLightOcclusion {
  const visibility = createIndirectVisibilityFromSnapshot(geometry)
  try {
    // Each angular sample retains both its exact candidate and hit distance.
    // The distances close sub-texel gaps between finely tessellated candidates.
    const samples = size * size, rayRecords = Math.ceil(samples / 2)
    const triangles = lights.length * (1 + rayRecords)
    const candidates = new Float32Array(triangles * 4)
    const primitives = new Map<number, number>(), origin = new Vector3()
    for (let light = 0; light < lights.length; light++) {
      origin.fromArray(lights[light].position)
      const start = lights.length + light * rayRecords
      origin.toArray(candidates, light * 4); candidates[light * 4 + 3] = start
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const hit = visibility.hit(origin, indirectOctDirection((x + .5) / size, (y + .5) / size), Infinity)
        if (hit?.faceIndex == null) continue
        const id = visibility.primitiveId(hit.faceIndex)
        if (!primitives.has(id)) primitives.set(id, primitives.size + 1)
        const address = start * 4 + (y * size + x) * 2
        candidates[address] = primitives.get(id)!
        candidates[address + 1] = hit.distance
      }
    }
    const source = visibility.triangleTexture().image.data as Float32Array
    const records = new Float32Array(candidates.length + primitives.size * 28)
    records.set(candidates)
    for (const [original, packed] of primitives) {
      records.set(source.subarray((original - 1) * 28, original * 28), candidates.length + (packed - 1) * 28)
    }
    return { records, lights, size, triangles }
  } finally { visibility.dispose() }
}

export const roomLightOcclusionGLSL = /* glsl */ `
uniform vec4 hdRoomOcclusion;
uniform float hdRoomOcclusionRequired;
bool hdRoomTriangleBlocks(int index, vec3 source, vec3 direction, float distanceToReceiver) {
  vec3 a=hdLightPortalRecord(index).xyz;
  vec3 e1=hdLightPortalRecord(index+1).xyz-a, e2=hdLightPortalRecord(index+2).xyz-a;
  vec3 h=cross(direction,e2);float determinant=dot(e1,h);
  if(abs(determinant)<1e-8)return false;
  vec3 s=source-a,q=cross(s,e1);
  float u=dot(s,h)/determinant,v=dot(direction,q)/determinant,t=dot(e2,q)/determinant;
  return u>=-1e-5&&v>=-1e-5&&u+v<=1.00001&&t>.00001&&t<1.0-.003/distanceToReceiver;
}
float hdRoomStoreyVisibility(float index, vec3 source, vec3 receiver) {
  if(hdRoomOcclusionRequired<.5)return 1.0;
  // Never reuse an outgoing/moved lamp's atlas while its replacement prepares.
  if(index<0.0||index>=hdRoomOcclusion.w)return 0.0;
  int start=int(hdRoomOcclusion.x),size=int(hdRoomOcclusion.z);
  vec4 light=hdLightPortalRecord(start+int(index));
  if(distance(light.xyz,source)>.002)return 0.0;
  vec3 direction=receiver-source;float distanceToReceiver=length(direction);
  if(distanceToReceiver<.003)return 1.0;
  vec3 n=direction/max(abs(direction.x)+abs(direction.y)+abs(direction.z),.00001);
  vec2 oct=n.xy;if(n.z<0.0)oct=(1.0-abs(oct.yx))*mix(vec2(-1.0),vec2(1.0),step(vec2(0.0),oct));
  vec2 pixel=clamp((oct*.5+.5)*float(size)-.5,vec2(0.0),vec2(float(size-1)));
  ivec2 base=ivec2(floor(pixel));ivec4 ids=ivec4(0);
  bool enclosed=true;
  // Only fill a missed silhouette when every surrounding sample hit solid
  // geometry well before this receiver. Keep a footprint-sized clearance so
  // the receiver's own tessellation cannot make it shadow itself.
  float clearance=.003+distanceToReceiver*4.0/float(size);
  for(int corner=0;corner<4;corner++){
    ivec2 c=min(base+ivec2(corner%2,corner/2),ivec2(size-1));
    int address=c.y*size+c.x;
    vec4 record=hdLightPortalRecord(start+int(light.w)+address/2);
    int component=(address%2)*2;
    ids[corner]=int(record[component]);
    enclosed=enclosed&&ids[corner]>0&&record[component+1]<distanceToReceiver-clearance;
  }
  for(int corner=0;corner<4;corner++){
    int id=ids[corner];if(id==0||(corner>0&&id==ids.x)||(corner>1&&id==ids.y)||(corner>2&&id==ids.z))continue;
    int primitive=start+int(hdRoomOcclusion.y)+(id-1)*7;
    if(hdRoomTriangleBlocks(primitive+1,source,direction,distanceToReceiver)||
       hdRoomTriangleBlocks(primitive+4,source,direction,distanceToReceiver))return 0.0;
  }
  return enclosed?0.0:1.0;
}
`
