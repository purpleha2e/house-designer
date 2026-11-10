export async function command(path,body){const r=await fetch('http://127.0.0.1:9188/'+path,{method:'POST',body:JSON.stringify(body)}),data=await r.json();if(data.error)throw Error(data.error);return data.value}
export const evaluate=expression=>command('evaluate',{expression});
export const call=(method,params)=>command('call',{method,params});
export const ready="(()=>{const u=roofWallScene().scene.userData,g=u.indirectLighting;return g?.state==='ready'&&!g.pendingLighting&&!g.pendingUpdate&&!g.saving&&!g.volumePending&&!u.shaderWarmupPending&&u.progressiveStartup?.phase==='full'})()";
export async function wait(expression,timeout=600000){const start=Date.now();while(!await evaluate(expression)){if(Date.now()-start>timeout)throw Error('Timeout '+expression);await new Promise(r=>setTimeout(r,250))}}
export async function menu(){if(!await evaluate(`!!document.querySelector('[aria-label="Sky intensity"]')`)){await evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`);await wait(`!!document.querySelector('[aria-label="Sky intensity"]')`)}}
export async function select(label,value){await menu();return evaluate(`(()=>{const e=document.querySelector(${JSON.stringify('[aria-label="'+label+'"]')});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)}
export async function closeMenu(){if(await evaluate(`!!document.querySelector('[aria-label="Sky intensity"]')`))await evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`)}
