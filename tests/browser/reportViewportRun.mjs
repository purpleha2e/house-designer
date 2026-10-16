import {readFileSync} from 'node:fs'
const report=JSON.parse(readFileSync(process.argv[2],'utf8'))
const end=report.draws.at(-1)?.at??0,start=Number(process.argv[3]??end-15000)
const draws=report.draws.filter(draw=>draw.at>=start)
console.log({start,end,navigation:report.navigation,tasks:report.tasks.filter(task=>task.at>=start).sort((a,b)=>b.ms-a.ms).slice(0,10),
  gaps:[...draws].sort((a,b)=>b.gap-a.gap).slice(0,8),drawCost:[...draws].sort((a,b)=>b.ms-a.ms).slice(0,8)})
