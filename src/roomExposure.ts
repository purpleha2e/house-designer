import { BlendFunction, Effect, ShaderPass } from 'postprocessing'
import { NearestFilter, ShaderMaterial, Uniform, WebGLRenderTarget, type WebGLRenderer } from 'three'

export const ROOM_EXPOSURE_STORAGE = 'house-designer.room-exposure.v1'

const vertexShader = `varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`
const decode = `float exposureValue(vec4 p){return (p.r+p.g/255.0)*2.0;}`

/** Meters the existing linear HDR image. No scene render, CPU readback, GI
 * mutation or feedback from the exposed/tone-mapped result is involved. */
export class RoomExposureEffect extends Effect {
  readonly meter = new WebGLRenderTarget(16, 16, { depthBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter })
  readonly history = [0, 1].map(() => new WebGLRenderTarget(1, 1, { depthBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter }))
  private index = 0
  private first = true
  private lastUpdate = 0
  private meterPass = new ShaderPass(new ShaderMaterial({
    vertexShader, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { inputBuffer: new Uniform(null) },
    fragmentShader: `uniform sampler2D inputBuffer;varying vec2 vUv;
void main(){
  vec3 rgb=max(texture2D(inputBuffer,vUv).rgb,vec3(0.0));
  float luminance=dot(rgb,vec3(0.2126,0.7152,0.0722));
  gl_FragColor=vec4(vec3(clamp((log2(max(luminance,0.000015258789))+16.0)/24.0,0.0,1.0)),1.0);
}`,
  }))
  private adaptationPass = new ShaderPass(new ShaderMaterial({
    vertexShader, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { inputBuffer: new Uniform(null), previous: new Uniform(null), elapsed: new Uniform(0), initial: new Uniform(true) },
    fragmentShader: `uniform sampler2D inputBuffer;uniform sampler2D previous;
uniform float elapsed;uniform bool initial;${decode}
void main(){
  float sum=0.0,weight=0.0;
  for(int y=0;y<16;y++)for(int x=0;x<16;x++){
    vec2 uv=(vec2(float(x),float(y))+0.5)/16.0;
    // Centre weighting plus a log mean keeps a small bright window from
    // setting the exposure for the whole room.
    float w=1.0+2.0*exp(-8.0*dot(uv-0.5,uv-0.5));
    sum+=(texture2D(inputBuffer,uv).r*24.0-16.0)*w;weight+=w;
  }
  float target=clamp(log2(0.12)-sum/weight,0.0,2.0);
  float old=initial?0.0:exposureValue(texture2D(previous,vec2(0.5)));
  // Recover from brightening faster when returning to a sunlit view.
  float rate=target<old?3.0:1.25;
  float stops=mix(old,target,1.0-exp(-elapsed*rate));
  float packed=clamp(stops/2.0,0.0,1.0)*255.0;
  gl_FragColor=vec4(floor(packed)/255.0,fract(packed),0.0,1.0);
}`,
  }))

  constructor() {
    super('RoomExposure', `uniform sampler2D roomExposure;${decode}
void mainImage(const in vec4 inputColor,const in vec2 uv,out vec4 outputColor){
  float stops=exposureValue(texture2D(roomExposure,vec2(0.5)));
  outputColor=vec4(inputColor.rgb*exp2(stops),inputColor.a);
}`, { blendFunction: BlendFunction.SRC, uniforms: new Map([['roomExposure', new Uniform(null)]]) })
  }

  update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget) {
    const target = renderer.getRenderTarget(), now = performance.now()
    const elapsed = this.first ? 1 / 60 : Math.min(0.25, Math.max(0, (now - this.lastUpdate) / 1000))
    const previous = this.history[this.index], next = this.history[1 - this.index]
    const uniforms = (this.adaptationPass.fullscreenMaterial as ShaderMaterial).uniforms
    uniforms.previous.value = previous.texture
    uniforms.elapsed.value = elapsed
    uniforms.initial.value = this.first
    try {
      this.meterPass.render(renderer, inputBuffer, this.meter)
      this.adaptationPass.render(renderer, this.meter, next)
    } finally { renderer.setRenderTarget(target) }
    this.uniforms.get('roomExposure')!.value = next.texture
    this.index = 1 - this.index; this.first = false; this.lastUpdate = now
  }

  dispose() {
    this.meter.dispose(); this.history.forEach(target => target.dispose())
    this.meterPass.dispose(); this.adaptationPass.dispose()
    super.dispose()
  }
}
