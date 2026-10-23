import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
const parse=file=>Object.fromEntries(readFileSync(file,'utf8').split(/\r?\n/).flatMap(line=>{const m=/^([A-Z_]+)=(.*)$/.exec(line);return m?[[m[1],m[2].trim().replace(/^(['"])(.*)\1$/,'$2')]]:[]}))
const env=parse('.env.workbuddy-sync'),tabs=parse('../tabs-manager/.env.workbuddy-sync')
for(const key of ['WORK_BUDDY_SITE_URL','WORK_BUDDY_SOURCE_ID','WORK_BUDDY_WRITE_KEY','WORK_BUDDY_READ_KEY'])assert.equal(env[key],tabs[key],`Connection files differ for ${key}`)
const deviceId='verification-'+randomUUID(),sourceDesktop='verification-'+randomUUID(),sourceBrowser='verification-'+randomUUID(),now=Date.now(),day=new Date(now).toLocaleDateString('en-CA')
const call=async(method,key,body)=>fetch(env.WORK_BUDDY_SITE_URL+'/work-buddy/activity'+(method==='GET'?`?deviceId=${deviceId}&day=${day}`:''),{method,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
const envelope=(sourceId,kind,records)=>({schemaVersion:1,sourceId,deviceId,kind,day,capturedAt:Date.now(),retentionDays:7,records})
const projectsCall=async(path,method,key,body)=>fetch(env.WORK_BUDDY_SITE_URL+path,{method,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
const catalog=(sourceId,kind,projects)=>({deviceId,sourceId,kind,capturedAt:Date.now(),projects})
try{
 for(const [source,kind,id] of [[sourceDesktop,'desktop','work-project'],[sourceBrowser,'browser','folder']])assert.equal((await projectsCall('/work-buddy/projects','PUT',env.WORK_BUDDY_WRITE_KEY,catalog(source,kind,[{id,name:'Synthetic project',archived:false}]))).status,200)
 const link={deviceId,browserSourceId:sourceBrowser,browserProjectId:'folder',projectId:'work-project',expectedRevision:0}
 assert.equal((await projectsCall('/work-buddy/project-link','PUT',env.WORK_BUDDY_WRITE_KEY,link)).status,200)
 assert.equal((await projectsCall('/work-buddy/project-link','PUT',env.WORK_BUDDY_WRITE_KEY,link)).status,409,'Stale writers cannot overwrite a newer mapping')
 assert.equal((await projectsCall('/work-buddy/projects','PUT',env.WORK_BUDDY_WRITE_KEY,catalog(sourceBrowser,'browser',[{id:'folder',name:'Renamed synthetic folder',archived:false}]))).status,200)
 const registryResponse=await projectsCall('/work-buddy/projects?deviceId='+deviceId,'GET',env.WORK_BUDDY_WRITE_KEY)
 assert.equal(registryResponse.status,200);const registry=await registryResponse.json();assert.equal(registry.links[0].projectId,'work-project');assert.equal(registry.browserProjects[0].name,'Renamed synthetic folder')
 assert.equal((await call('GET',env.WORK_BUDDY_WRITE_KEY)).status,401)
 const desktop={id:randomUUID(),sourceId:sourceDesktop,deviceId,kind:'desktop',state:'active',start:now-10000,end:now-5000,app:'chrome.exe',title:'Synthetic verification'}
 const browser={...desktop,id:randomUUID(),sourceId:sourceBrowser,kind:'browser',domain:'example.com',url:'https://example.com/docs?token=remove#fragment',projectName:'Verification'}
 for(const data of [envelope(sourceDesktop,'desktop',[desktop]),envelope(sourceBrowser,'browser',[browser])]){const response=await call('PUT',env.WORK_BUDDY_WRITE_KEY,data);assert.equal(response.status,200,`Upload HTTP ${response.status}`)}
 const response=await call('GET',env.WORK_BUDDY_READ_KEY);assert.equal(response.status,200);const result=await response.json();assert.equal(result.sources.length,2)
 const cloudBrowser=result.sources.find(s=>s.data.kind==='browser').data.records[0];assert.equal(cloudBrowser.url,'https://example.com/docs')
 const unauthorized=await call('PUT',env.WORK_BUDDY_READ_KEY,envelope(sourceDesktop,'desktop',[]));assert.equal(unauthorized.status,401)
 console.log(JSON.stringify({liveConvex:'passed',matchingEnvironmentFiles:true,pairedSources:2,sanitizedURL:true,separateReadWriteAuthorization:true,deviceId,sourceDesktop,sourceBrowser}))
}finally{
 const response=await projectsCall('/work-buddy/projects?deviceId='+deviceId,'GET',env.WORK_BUDDY_READ_KEY)
 if(response.ok){const registry=await response.json();for(const link of registry.links)await projectsCall('/work-buddy/project-link','PUT',env.WORK_BUDDY_WRITE_KEY,{...link,deviceId,projectId:null,expectedRevision:link.revision})}
 for(const [source,kind] of [[sourceDesktop,'desktop'],[sourceBrowser,'browser']])assert.equal((await projectsCall('/work-buddy/projects','PUT',env.WORK_BUDDY_WRITE_KEY,catalog(source,kind,[]))).status,200)

 for(const [sourceId,kind] of [[sourceDesktop,'desktop'],[sourceBrowser,'browser']]){const response=await call('PUT',env.WORK_BUDDY_WRITE_KEY,envelope(sourceId,kind,[]));assert.equal(response.status,200)}
}
