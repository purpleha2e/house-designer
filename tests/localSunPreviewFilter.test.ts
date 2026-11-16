import test from 'node:test'
import assert from 'node:assert/strict'
import {filterLocalSunPreview} from '../src/localSunPreviewFilter.ts'

function fixture(){
 const image=new Float32Array(3*3*4),normals=new Float32Array(image.length),positions=new Float32Array(3*3*3)
 for(let y=0;y<3;y++)for(let x=0;x<3;x++){const i=y*3+x;image.set([2,3,4,5],i*4);normals.set([0,0,1,1],i*4);positions.set([x*.01,y*.01,0],i*3)}
 return{image,normals,positions}
}
test('preview denoising preserves constant irradiance, depth, support and its input buffers',()=>{
 const f=fixture(),before=new Float32Array(f.image),out=filterLocalSunPreview(f.image,f.normals,f.positions,3,3)
 assert.deepEqual(out,before);assert.deepEqual(f.image,before);assert.notEqual(out,f.image)
})
test('preview denoising reduces a surface impulse while remaining a bounded convex average',()=>{
 const f=fixture();for(let i=0;i<9;i++)f.image.set([0,0,0],i*4);f.image.set([9,6,3],4*4)
 const out=filterLocalSunPreview(f.image,f.normals,f.positions,3,3)
 assert.ok(out[16]>0&&out[16]<9);assert.ok(out[0]>0)
 for(let i=0;i<9;i++){assert.ok(out[i*4]>=0&&out[i*4]<=9);assert.equal(out[i*4+3],5)}
})
test('preview filtering cannot leak across a thin wall, a normal discontinuity or unsupported samples',()=>{
 const f=fixture();f.image.set([100,100,100],0);f.positions[2]=.04
 f.image.set([100,100,100],4);f.normals.set([1,0,0,1],4)
 f.image.set([100,100,100],8);f.normals[11]=0
 for(const passes of [1,4]){const out=filterLocalSunPreview(f.image,f.normals,f.positions,3,3,passes)
 assert.deepEqual(Array.from(out.subarray(16,19)),[2,3,4]);assert.deepEqual(Array.from(out.subarray(8,12)),Array.from(f.image.subarray(8,12)));assert.equal(f.normals[11],0)}
})

test('progressive surface filtering suppresses broad sampling noise without changing average energy',()=>{
 const width=32,height=32,image=new Float32Array(width*height*4),normals=new Float32Array(image.length),positions=new Float32Array(width*height*3)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;image.set([((x*7+y*13)%17)/8,1,1,5],i*4);normals.set([0,0,1,1],i*4);positions.set([x*.03,y*.03,0],i*3)}
 const out=filterLocalSunPreview(image,normals,positions,width,height,4)
 let variance=0,original=0,mean=0
 for(let i=0;i<width*height;i++){variance+=(out[i*4]-1)**2;original+=(image[i*4]-1)**2;mean+=out[i*4];assert.equal(out[i*4+3],5)}
 assert.ok(variance<original*.02);assert.ok(Math.abs(mean/(width*height)-1)<.02)
})
