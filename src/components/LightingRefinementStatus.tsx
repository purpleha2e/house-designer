import {useSyncExternalStore} from 'react'
import type {createLightingRefinementStatus} from '../lightingRefinement'

export function LightingRefinementStatus({store,fallback,prefix=''}:{store:ReturnType<typeof createLightingRefinementStatus>;fallback:string;prefix?:string}){
 const value=useSyncExternalStore(store.subscribe,store.get,store.get)||fallback
 return <span title={value}>{prefix}{value}</span>
}
