import fs from 'node:fs'
const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),route=request.route??'/evaluate';delete request.route
const response=await fetch('http://127.0.0.1:9187'+route,{method:'POST',body:JSON.stringify(request)}),result=await response.json()
if(!response.ok)throw Error(result.error)
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result.value,null,2));else console.log(JSON.stringify(result.value))
