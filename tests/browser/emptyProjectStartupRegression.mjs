import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'

// Exercise the actual entry point, including the production build on 4173.
const browser=await lightingBrowser()
const ready=`(()=>{const s=document.querySelector('[aria-label="3D engine status"]');return s?.dataset.giStatus?.startsWith('GI ready')&&s.textContent.startsWith('GI ready')})()`
async function check(label){
  await browser.wait(ready,30000)
  assert.deepEqual(await browser.evaluate(`[...document.querySelector('[aria-label="2D editing floor"]').options].map(o=>o.textContent)`),['Floor 0'])
  assert.match(await browser.evaluate(`document.querySelector('[aria-label="3D engine status"]').textContent`),/0 probes/)
  console.log(`PASS ${label}: empty project finishes lighting preparation`)
}
try {
  await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??4173}/`})
  await check('fresh startup')
  await browser.evaluate('window.beforeStartupReload=true')
  await browser.call('Page.reload')
  await browser.wait(`!window.beforeStartupReload&&!!document.querySelector('[aria-label="Project menu"]')`)
  await check('reload')
  const floor=await browser.evaluate(`document.querySelector('[aria-label="2D editing floor"]').value`)
  await browser.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await browser.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent.trim()==='New').click()`)
  await browser.wait(`document.querySelector('[aria-label="2D editing floor"]').value!==${JSON.stringify(floor)}`)
  await check('New project')
  assert.deepEqual(browser.errors,[])
} finally {browser.close()}
