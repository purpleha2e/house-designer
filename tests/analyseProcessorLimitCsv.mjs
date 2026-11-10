import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

export function parseCsvLine(line){
  const fields=[];let field='',quoted=false
  for(let i=0;i<line.length;i++){
    const c=line[i]
    if(c==='"'){
      if(quoted&&line[i+1]==='"'){field+='"';i++}else quoted=!quoted
    }else if(c===','&&!quoted){fields.push(field.trim());field=''}else field+=c
  }
  fields.push(field.trim());return fields
}

export function analyseProcessorEvents(text){
  const counts={},biosCaps=[]
  for(const line of text.split(/\r?\n/)){
    if(!line.startsWith('Microsoft-Windows-Kernel-Processor-Power'))continue
    const row=parseCsvLine(line),id=Number(row[2]),version=Number(row[3])
    counts[id]=(counts[id]??0)+1
    // Names/order verified from this machine's installed provider metadata:
    // Event 47 v0, task BiosCapChange, Group UInt16, Number UInt8, Cap UInt32.
    if(id===47&&version===0){
      const timestamp=new Date(Number((BigInt(row[16])-116444736000000000n)/10000n)).toISOString()
      biosCaps.push({utc:timestamp,group:Number(row[19]),processor:Number(row[20]),cap:Number(row[21])})
    }
  }
  return {counts,biosCaps,processors:[...new Set(biosCaps.map(row=>`${row.group}:${row.processor}`))],
    caps:[...new Set(biosCaps.map(row=>row.cap))],
    note:'BiosCapChange identifies a firmware-reported cap; it does not identify its temperature/power trigger.'}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(!process.argv[2])throw Error('Provide the CSV produced by tracerpt -of CSV')
  const result=analyseProcessorEvents(readFileSync(process.argv[2],'utf8'))
  const output=process.argv[3]??'tmp/viewport-fps/processor-trace/limit-events.json'
  writeFileSync(output,JSON.stringify(result,null,2))
  console.log(JSON.stringify(result,null,2))
}
