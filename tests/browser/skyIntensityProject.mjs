import fs from 'node:fs'
/** Frozen fixture variant: only the bedroom's inward-facing paint assignments. */
export function whiteSkyProject(project){
 const timeless=JSON.parse(fs.readFileSync('src/materials/catalog/dulux-timeless-matt.json'))
 project.surfaceAssignments=project.surfaceAssignments.map(a=>{
  const t=a.target,f=t.fragmentId??'',white=t.side===1&&(t.wallId==='6cccfa67-4575-4c05-a025-316c33a128dd'||t.wallId==='ddb019b5-cc88-4862-a03f-0182fb728f3b'&&f.includes(':10.3107:14.4054:')||t.wallId==='9b7e85a0-ee9b-4fcb-9f55-d237dae97e33'||t.wallId==='4f92da70-3afc-4dfd-8d96-f450b6bb9402'&&(f.includes('04edfb6d')||f.includes(':-13.466:-10.3092:')||f.includes(':-14.4039:-13.466:')))
  return white&&a.materialId==='dulux-timeless-matt'?{...a,materialId:'sky-calibration-white'}:a
 })
 project.materialDefinitions=[...(project.materialDefinitions??[]),{...timeless,id:'sky-calibration-white',manufacturer:'Calibration',productName:'Neutral white',pbr:{...timeless.pbr,baseColor:'#ffffff'}}]
 return project
}
