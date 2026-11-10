import { build, preview } from 'vite'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
const [action='build',folder='tmp/renderer-isolation/production-after',port='5212']=process.argv.slice(2),out=resolve(folder)
if(action==='build'){
  if(existsSync(out)&&readdirSync(out).length)throw Error('Use a fresh evidence directory')
  mkdirSync(out,{recursive:true})
  await build({build:{outDir:out,emptyOutDir:false,minify:false,sourcemap:true,rollupOptions:{input:{app:resolve('index.html'),editor:resolve('tests/browser/editorRegression.html'),isolation:resolve('tests/browser/rendererIsolation.html')}}}})
  for(const name of ['colin_house_v2.json','springfield_14.json'])copyFileSync(name,resolve(out,name))
}else if(action!=='serve'||!existsSync(resolve(out,'index.html')))throw Error('Existing production entry required')
const server=await preview({build:{outDir:out},preview:{host:'127.0.0.1',port:Number(port),strictPort:true}})
server.printUrls()
