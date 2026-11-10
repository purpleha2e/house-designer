import {DataTexture,FloatType,NearestFilter,NoColorSpace,RGBAFormat,Vector4} from 'three'
import type {BarrierData} from './giBarrierGeometry.ts'

export function barrierTexture(data:BarrierData){
 const texture=new DataTexture(data.data,data.width,data.height,RGBAFormat,FloatType);texture.minFilter=texture.magFilter=NearestFilter;texture.generateMipmaps=false;texture.colorSpace=NoColorSpace;texture.needsUpdate=true
 return{texture,uniforms:{hdBarrierAtlas:{value:texture},hdBarrierInfo:{value:new Vector4(data.width,data.height,data.pageBase,64)},hdBarrierOffsets:{value:new Vector4(...data.offsets as[number,number,number,number])}}}
}
export function barrierGLSL(mode:'A'|'B'){
 return/*glsl*/`
uniform sampler2D hdBarrierAtlas;
uniform vec4 hdBarrierInfo,hdBarrierOffsets;
vec4 hdBarrierPixel(int address){int width=int(hdBarrierInfo.x);return texelFetch(hdBarrierAtlas,ivec2(address%width,address/width),0);}
float hdBarrierScalar(int address){return hdBarrierPixel(address/4)[address%4];}
int hdBarrierHeader(int cell){int page=int(hdBarrierScalar(cell/64)+.5);if(page==0)return 0;return int(hdBarrierScalar(int(hdBarrierInfo.z)*4+(page-1)*64+cell%64));}
bool hdBarrierCrosses(float a,float b){return a>.00001&&b<-.00001||b>.00001&&a<-.00001;}
bool hdBarrierTriangle(int index,vec3 p,vec3 q){
 int at=int(hdBarrierOffsets.z)+index*3;vec3 origin=hdBarrierPixel(at).xyz,e1=hdBarrierPixel(at+1).xyz,e2=hdBarrierPixel(at+2).xyz;
 vec3 normal=cross(e1,e2);float lengthN=length(normal);if(lengthN<1.e-12)return false;
 vec3 relative=p-origin,direction=q-p;float a=dot(normal,relative)/lengthN,b=dot(normal,q-origin)/lengthN;if(!hdBarrierCrosses(a,b))return false;
 vec3 h=cross(direction,e2),c=cross(relative,e1);float determinant=dot(e1,h);if(abs(determinant)<1.e-20)return false;
 vec2 uv=vec2(dot(relative,h),dot(direction,c))/determinant;
 return all(greaterThanEqual(uv,vec2(-.00001)))&&uv.x+uv.y<=1.00001;
}
bool hdBarrierValid(int header,vec3 p,vec3 q){
 ${mode==='B'?`if(header>0){int at=int(hdBarrierOffsets.w)+(header-1)*2;vec4 plane=hdBarrierPixel(at);float other=hdBarrierPixel(at+1).x;float a=dot(plane.xyz,p),b=dot(plane.xyz,q);return !hdBarrierCrosses(a-plane.w,b-plane.w)&&!hdBarrierCrosses(a-other,b-other);}header=-header;`:''}
 vec2 record=hdBarrierPixel(int(hdBarrierOffsets.x)+header-1).xy;
 for(int i=0;i<int(record.y);i++){int triangle=int(hdBarrierScalar(int(hdBarrierOffsets.y)*4+int(record.x)+i)+.5);if(hdBarrierTriangle(triangle,p,q))return false;}
 return true;
}
vec3 hdBarrierPosition(ivec3 tap,int floorIndex,bool isFloor){
 float size=isFloor?hdGIFloorLayerSize.x:hdGIVolumeSize.x;
 vec2 xz=hdGIBounds.xy+vec2(tap.xz)/(size-1.)*hdGIBounds.z;
 vec2 range=hdGIFloorRanges[floorIndex];float y=range.x+.076;
 if(!isFloor){
  float raw=max(range.x+.12,mix(range.x,range.y,float(tap.y)/11.));
  ivec2 m=ivec2(min(vec2(511.),floor(vec2(tap.xz)/(size-1.)*512.)));m.y+=floorIndex*512;
  vec3 mask=texelFetch(hdGIMask,m,0).rgb;float ceiling=mix(range.x,range.y,dot(mask.gb,vec2(65280.,255.))/65535.);
  y=mask.r>.5?max(range.x+.12,min(raw,ceiling-.06)):raw;
 }
 return vec3(xz.x,y,xz.y);
}
vec3 hdBarrierManual(float floorIndex,vec3 p,vec3 n,float floorReceiver,int header,out vec3 meanLight,out float support){
 bool isFloor=floorReceiver>.5;int size=int(isFloor?hdGIFloorLayerSize.x:hdGIVolumeSize.x),floorId=int(floorIndex),layerHeight=int(isFloor?hdGIFloorLayerSize.y:hdGIVolumeSize.y);
 vec2 range=hdGIFloorRanges[floorId];vec2 xz=clamp((p.xz-hdGIBounds.xy)/hdGIBounds.z,0.,1.)*float(size-1);float y=clamp((p.y-range.x)/(range.y-range.x),0.,1.)*11.;
 ivec3 base=ivec3(min(ivec2(floor(xz)),ivec2(size-2)).x,min(10,int(floor(y))),min(ivec2(floor(xz)),ivec2(size-2)).y);
 vec3 fraction=vec3(xz.x-float(base.x),isFloor?0.:y-float(base.y),xz.y-float(base.z));vec3 receiver=p;if(isFloor)receiver.y=range.x+.076;
 vec3 coefficients[${'HD_GI_COEFFICIENT_COUNT_INT'}];for(int k=0;k<HD_GI_COEFFICIENT_COUNT_INT;k++)coefficients[k]=vec3(0.);support=0.;
 for(int corner=0;corner<8;corner++){
  if(isFloor&&corner>=4)break;
  ivec3 delta=isFloor?ivec3(corner%2,0,corner/2):ivec3(corner%2,(corner/2)%2,corner/4),tap=base+delta;
  float weight=(delta.x==1?fraction.x:1.-fraction.x)*(delta.z==1?fraction.z:1.-fraction.z)*(isFloor?1.:delta.y==1?fraction.y:1.-fraction.y);
  if(weight<=0.||!hdBarrierValid(header,receiver,hdBarrierPosition(tap,floorId,isFloor)))continue;
  int row=isFloor?floorId:floorId*14+tap.y+1;ivec3 uv=ivec3(tap.x,row,tap.z);
  vec4 c0=isFloor?texelFetch(hdGIFloorLayer,uv,0):texelFetch(hdGIVolume,uv,0);
  support+=c0.a*weight;coefficients[0]+=c0.rgb*weight;
  for(int k=1;k<HD_GI_COEFFICIENT_COUNT_INT;k++){uv.y=row+k*layerHeight;coefficients[k]+=(isFloor?texelFetch(hdGIFloorLayer,uv,0):texelFetch(hdGIVolume,uv,0)).rgb*weight;}
 }
 float coverage=max(support,.00001);meanLight=coefficients[0]*(.886227/coverage);
 vec3 light=coefficients[0]*.886227+1.023328*(coefficients[1]*n.y+coefficients[2]*n.z+coefficients[3]*n.x);
 #ifdef HD_GI_L2
 light+=.8580855308097834*(coefficients[4]*n.x*n.y+coefficients[5]*n.y*n.z+coefficients[7]*n.x*n.z)+coefficients[6]*(.24770795610037571*(3.*n.z*n.z-1.))+coefficients[8]*(.4290427654048917*(n.x*n.x-n.y*n.y));
 #endif
 return max(light/coverage,vec3(0.));
}
int hdBarrierCell(float floorIndex,vec3 p,float floorReceiver){
 int f=int(hdGIFloorLayerSize.x)-1,v=int(hdGIVolumeSize.x)-1;vec2 plan=clamp((p.xz-hdGIBounds.xy)/hdGIBounds.z,0.,1.);
 if(floorReceiver>.5){ivec2 cell=min(ivec2(floor(plan*float(f))),ivec2(f-1));return(int(floorIndex)*f+cell.y)*f+cell.x;}
 ivec2 cell=min(ivec2(floor(plan*float(v))),ivec2(v-1));vec2 range=hdGIFloorRanges[int(floorIndex)];int y=min(10,int(floor(clamp((p.y-range.x)/(range.y-range.x),0.,1.)*11.)));
 return f*f*hdGIFloorCount+((int(floorIndex)*11+y)*v+cell.y)*v+cell.x;
}
`
}
/** Modify only the final reconstruction function; all source/transport inputs
 * and the completed coefficient textures remain unchanged. */
export function injectBarrierShader(fragment:string,mode:'A'|'B'){
 const declaration='vec3 hdGIVolumeSample(float floorIndex, vec3 p, vec3 n, float floorReceiver, out vec3 meanLight, out float support) {'
 if(!fragment.includes(declaration))throw Error('Production GI sampling function not found')
 const defines=`\n#ifdef HD_GI_L2\n#define HD_GI_COEFFICIENT_COUNT_INT 9\n#else\n#define HD_GI_COEFFICIENT_COUNT_INT 4\n#endif\n`
 return fragment.replace(declaration,defines+barrierGLSL(mode)+declaration+`\nint hdBarrierId=hdBarrierHeader(hdBarrierCell(floorIndex,p,floorReceiver));if(hdBarrierId!=0)return hdBarrierManual(floorIndex,p,n,floorReceiver,hdBarrierId,meanLight,support);`)
}
