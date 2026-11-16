import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {LightingRefinementStatus} from '../../src/components/LightingRefinementStatus'
import {createLightingRefinementStatus} from '../../src/lightingRefinement'
let parentRenders=0
function HouseHost(){
 parentRenders++
 const [status]=useState(createLightingRefinementStatus)
 Object.assign(window,{statusTest:{status,parentRenders:()=>parentRenders}})
 return <LightingRefinementStatus store={status} fallback="Ready" />
}
createRoot(document.getElementById('root')!).render(<HouseHost />)
