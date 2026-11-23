import { EffectPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing'
import { DataTexture, DataUtils, FloatType, HalfFloatType, PerspectiveCamera, RedFormat, RGBAFormat, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { LumenViewportPass } from '../../src/lumenViewportPass'

export function linearToSRGB(value: number) {
  return value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055
}

// Analytic ACES filmic fit for equal RGB channels. Exercise the actual editor
// composite shader and actual tone-mapping effect with independently known GI.
function toneGray(linear: number, exposure: number) {
  const x = linear * exposure / .6
  const aces = (x * (x + .0245786) - .000090537) / (x * (.983729 * x + .432951) + .238081)
  return Math.round(255 * linearToSRGB(Math.max(0, Math.min(1, aces))))
}

export async function checkLumenComposition() {
  const width = 8, height = 8, low = 2, distance = 2, base = .03125, exposure = 1.25
  const gl = new WebGLRenderer({antialias:false,preserveDrawingBuffer:true})
  gl.setSize(width,height,false);gl.toneMappingExposure=exposure
  const camera = new PerspectiveCamera(45,1,.1,10)
  camera.updateMatrixWorld(true)
  const normalizedDepth = new Vector3(0,0,-distance).project(camera).z*.5+.5
  const pass = new LumenViewportPass(camera)
  pass.upload({origin:[0,0,0],dimensions:[1,1,1],spacing:.12,count:1,width:256,height:1,
    cells:new Uint32Array([1]),positions:new Float32Array(1024),normals:new Float32Array(1024),albedo:new Float32Array(1024)})
  const tone = new EffectPass(camera,new ToneMappingEffect({mode:ToneMappingMode.ACES_FILMIC}))
  tone.initialize(gl,false,HalfFloatType);tone.setSize(width,height);tone.renderToScreen=true
  const texture = (data:Float32Array,w:number,h:number,format=RGBAFormat) => {
    const result = new DataTexture(data,w,h,format,FloatType);result.needsUpdate=true;return result
  }
  const rgba = (pixels:number,fill:(index:number)=>number[]) => new Float32Array(Array.from({length:pixels},(_,i)=>fill(i)).flat())
  const depth = texture(new Float32Array(width*height).fill(normalizedDepth),width,height,RedFormat)
  const display = texture(rgba(width*height,()=>[base,base,base,1]),width,height)
  const metadata = texture(rgba(low*low,()=>[0,0,1,1]),low,low)
  const field = texture(rgba(low*low,()=>[0,0,0,distance]),low,low)
  const output = new WebGLRenderTarget(width,height,{type:HalfFloatType,depthBuffer:false})
  const u=pass.displayMaterial.uniforms
  u.sceneDepth.value=depth;u.displayColour.value=display;u.rawGeometry.value=metadata;u.bounceTexture.value=field
  u.inverseProjection.value.copy(camera.projectionMatrixInverse);u.cameraWorld.value.copy(camera.matrixWorld)
  const report=[]
  try {
    for (const [name,grid] of [['constant',[.0625,.0625,.0625,.0625]],['gradient',[.015625,.0625,.125,.25]],['single bright source',[0,0,0,.5]]] as const) {
      field.image.data.set(rgba(4,i=>[grid[i],grid[i],grid[i],distance]));field.needsUpdate=true
      for(const mode of [0,22,21]){
        u.diagnostic.value=mode
        gl.setRenderTarget(output);gl.render(pass.scene,pass.camera)
        const context=gl.getContext(),error=context.getError()
        if(error!==context.NO_ERROR)throw Error(`Linear control WebGL error ${error}`)
        const before = new Uint16Array(width*height*4)
        await gl.readRenderTargetPixelsAsync(output,0,0,width,height,before)
        tone.render(gl,output,output,0,false)
        const displayed = new Uint8Array(width*height*4)
        context.readPixels(0,0,width,height,context.RGBA,context.UNSIGNED_BYTE,displayed)
        let maxLinearError=0,maxDisplayError=0
        for(let y=0;y<height;y++)for(let x=0;x<width;x++){
          const clamp=(v:number)=>Math.min(1,Math.max(0,v))
          const u=clamp((x+.5)*low/width-.5),v=clamp((y+.5)*low/height-.5)
          const indirect=(1-v)*(grid[0]*(1-u)+grid[1]*u)+v*(grid[2]*(1-u)+grid[3]*u)
          const expected=mode===0?base+indirect:indirect*(mode===21?16:1)
          for(let c=0;c<3;c++){
            const i=(y*width+x)*4+c
            maxLinearError=Math.max(maxLinearError,Math.abs(expected-DataUtils.fromHalfFloat(before[i])))
            maxDisplayError=Math.max(maxDisplayError,Math.abs(toneGray(expected,exposure)-displayed[i]))
          }
        }
        report.push({name,mode,maxLinearError,maxDisplayError})
      }
    }
    return report
  } finally {
    tone.dispose();pass.dispose();output.dispose();depth.dispose();display.dispose();metadata.dispose();field.dispose();gl.dispose();gl.forceContextLoss()
  }
}
