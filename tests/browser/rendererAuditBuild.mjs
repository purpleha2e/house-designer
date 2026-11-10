// Production packaging for the existing audit fixture. No production defines
// are overridden and no renderer or lighting defaults are changed.
import {build,preview,createServer} from 'vite'
import {copyFileSync,existsSync,mkdirSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
if(process.argv[2]==='dev'){
 const server=await createServer({server:{host:'127.0.0.1',port:Number(process.argv[3]??5193),strictPort:true,watch:{ignored:['**/tmp/renderer-phase3/**']}}})
 await server.listen();server.printUrls()
}else{
const existing=process.argv[2]==='serve'
const out=resolve(process.argv[existing?3:2]??'tmp/renderer-phase3/production-baseline'),port=Number(process.argv[existing?4:3]??5194)
if(existing){if(!existsSync(resolve(out,'tests/browser/rendererRecovery.html')))throw Error('Existing audit build not found')}
else{
 if(existsSync(out)&&readdirSync(out).length)throw Error('Choose a fresh build directory; existing experiments are preserved')
 mkdirSync(out,{recursive:true})
 await build({build:{outDir:out,emptyOutDir:false,sourcemap:true,rollupOptions:{input:{app:resolve('index.html'),recovery:resolve('tests/browser/rendererRecovery.html')}}}})
 copyFileSync('colin_house_v2.json',resolve(out,'colin_house_v2.json'))
}
const server=await preview({preview:{host:'127.0.0.1',port,strictPort:true},build:{outDir:out}})
server.printUrls()
}
