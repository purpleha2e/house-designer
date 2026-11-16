import {writeFileSync} from 'node:fs';
import {lightingBrowser} from '../tests/browser/lightingHarness.mjs';
import {installRenderLoopPreload} from '../tests/browser/renderLoopAuditProbe.mjs';
const b=await lightingBrowser();
try {
 await b.call('Security.setIgnoreCertificateErrors',{ignore:true});
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installRenderLoopPreload.toString()})();`});
 await b.call('Page.navigate',{url:'https://192.168.1.57:4174/'});
 await b.wait(`!!document.querySelector('.house-viewer')&&!!loopFind().state?.scene`,30000);
 await b.wait(`!loopFind().state.scene.userData.shaderWarmupPending&&loopFind().state.scene.children.length>5`,90000);
 console.log(JSON.stringify(await b.evaluate(`({secure:isSecureContext,title:document.title,text:document.body.innerText,meshes:(()=>{let count=0;loopFind().state.scene.traverse(o=>{if(o.isMesh)count++});return count})()})`)));
 console.log('Errors',JSON.stringify(b.errors));
 const screenshot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync('tmp/monty-quest-preview.png',Buffer.from(screenshot.data,'base64'));
 if(b.errors.length)process.exitCode=1;
}finally{b.close()}
