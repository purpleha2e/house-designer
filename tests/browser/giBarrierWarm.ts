import {HalfFloatType,WebGLRenderTarget} from 'three'
import type {RootState} from '@react-three/fiber'
export async function warmBarrierShaders(s:RootState){
 const target=new WebGLRenderTarget(s.gl.domElement.width,s.gl.domElement.height,{type:HalfFloatType}),before=s.gl.getRenderTarget()
 try{s.gl.setRenderTarget(target);await s.gl.compileAsync(s.scene,s.camera)}finally{s.gl.setRenderTarget(before);target.dispose()}
}
