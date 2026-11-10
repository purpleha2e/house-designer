import { build, preview } from 'vite'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const [mode='current',folder='tmp/shader-preparation/production-reference',port='5220']=process.argv.slice(2),out=resolve(folder)
if(mode!=='serve'){
 if(existsSync(out)&&readdirSync(out).length)throw Error('Choose a fresh evidence build directory')
 mkdirSync(out,{recursive:true})
 const frozen=new Map(['src/shaderWarmup.ts','src/shaderDiagnostics.ts','src/components/SceneRenderer.tsx','src/components/IndirectLighting.tsx','src/components/ThreeDView.tsx'].map(p=>[resolve(p).replaceAll('\\','/'),resolve('tmp/shader-preparation/before-source',p.split('/').at(-1))]))
 await build({plugins:mode==='reference'?[{name:'immutable-shader-reference',enforce:'pre',load(id){const file=frozen.get(id.split('?')[0]);if(file)return readFileSync(file,'utf8')}}]:[],build:{outDir:out,emptyOutDir:false,minify:false,sourcemap:true,rollupOptions:{input:{app:resolve('index.html'),editor:resolve('tests/browser/shaderPreparationEditor.html'),fixture:resolve('tests/browser/shaderPreparation.html'),raw:resolve('tests/browser/shaderSynchronization.html'),tour:resolve('tests/browser/shaderPreparationTour.html')}}}})
 for(const name of ['colin_house_v2.json','springfield_14.json'])copyFileSync(name,resolve(out,name))
}else if(!existsSync(resolve(out,'index.html')))throw Error('Existing build required')
if(mode!=='verify'){const server=await preview({build:{outDir:out},preview:{host:'127.0.0.1',port:Number(port),strictPort:true}});server.printUrls()}
