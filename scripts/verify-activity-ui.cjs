const { _electron } = require('../../tabs-manager/node_modules/playwright')
const { DatabaseSync } = require('node:sqlite')
const {mkdtempSync,writeFileSync,mkdirSync}=require('node:fs')
const {tmpdir}=require('node:os')
const path=require('node:path')
const assert=require('node:assert/strict')
const root=path.resolve(__dirname,'..'),profile=mkdtempSync(path.join(tmpdir(),'work-buddy-activity-ui-')),output=path.join(root,'.artifacts','activity')
mkdirSync(output,{recursive:true})
const now=Date.now(),day=new Date(now).toLocaleDateString('en-CA'),base=now-3*3600000
const db=new DatabaseSync(path.join(profile,'activity.sqlite'))
db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE intervals(id TEXT PRIMARY KEY,day TEXT NOT NULL,body TEXT NOT NULL);CREATE TABLE remote(source TEXT NOT NULL,day TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(source,day));')
const config={enabled:false,captureTitles:false,idleSeconds:60,excludedApps:[],excludedTitlePatterns:[],retentionDays:30,cloudEnabled:false,siteUrl:'',deviceId:'test-pc'}
db.prepare('INSERT INTO meta VALUES (?,?)').run('config',JSON.stringify(config));db.prepare('INSERT INTO meta VALUES (?,?)').run('sourceId',JSON.stringify('test-desktop'))
const record=(id,start,end,extra={})=>({id,sourceId:'test-desktop',deviceId:'test-pc',kind:'desktop',state:'active',app:'Code.exe',title:'Work Buddy · activity timeline',start:base+start,end:base+end,...extra})
for(const row of [record('code',0,3600000),record('chrome',3600000,5400000,{app:'chrome.exe',title:''}),record('idle',5400000,6000000,{app:'',title:'',state:'idle'})])db.prepare('INSERT INTO intervals VALUES (?,?,?)').run(row.id,day,JSON.stringify(row))
const browser=record('browser',3600000,5400000,{sourceId:'test-browser',kind:'browser',app:'chrome.exe',title:'Convex documentation',domain:'docs.convex.dev',url:'https://docs.convex.dev/functions/http-actions',projectName:'Work Buddy',browserProjectId:'browser-project'})
db.prepare('INSERT INTO remote VALUES (?,?,?)').run('test-browser',day,JSON.stringify({schemaVersion:1,sourceId:'test-browser',deviceId:'test-pc',kind:'browser',day,capturedAt:now,retentionDays:30,records:[browser]}));db.close()
const bootstrap=path.join(profile,'bootstrap.cjs')
writeFileSync(bootstrap,`const {app}=require('electron');app.setLoginItemSettings=()=>{};app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root,'out/main/index.js'))});`)
;(async()=>{
 const electron=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[bootstrap],env:{...process.env,ELECTRON_ENABLE_LOGGING:'0'}})
 const errors=[]
 try{
  const page=await electron.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button',{name:'Активність ПК',exact:true}).click()
  await page.getByText('Хронологія спостережень',{exact:true}).waitFor()
  await page.getByText('Convex documentation',{exact:true}).waitFor()
  assert.equal(await page.locator('.activity-row').count(),3)
  const handle=await electron.browserWindow(page);await handle.evaluate(window=>window.setSize(380,900))
  const navPositions=await page.locator('.tab-bar>button').evaluateAll(buttons=>buttons.map(b=>b.getBoundingClientRect().top));assert.ok(Math.max(...navPositions)-Math.min(...navPositions)<2,'Navigation must fit on one row')
  await page.screenshot({path:path.join(output,'desktop-timeline-380.png')})
  await page.getByRole('button',{name:'Налаштування активності',exact:true}).click()
  await page.screenshot({path:path.join(output,'desktop-settings-380.png')})
  const overflow=await page.locator('.activity-page').evaluate(el=>el.scrollWidth>el.clientWidth)
  assert.equal(overflow,false,'Activity page must fit the narrow tracker window')
  await page.getByRole('button',{name:'Налаштування активності',exact:true}).click()
  await page.locator('.activity-row').first().click();await page.getByRole('button',{name:'Закрити редактор',exact:true}).waitFor()
  await page.getByLabel('Нотатка активності').fill('Checked activity capture')
  await page.getByRole('button',{name:'Зберегти уточнення',exact:true}).click()
  await page.waitForFunction(async()=>{const d=await window.workBuddy.getActivityDay(new Date().toLocaleDateString('en-CA'));return d.assignments.some(a=>a.note==='Checked activity capture')})
  // Check the actual native helper in this isolated profile, then pause it again.
  const result=await page.evaluate(async()=>{const day=new Date().toLocaleDateString('en-CA'),before=await window.workBuddy.getActivityDay(day);await window.workBuddy.configureActivity({...before.status.config,enabled:true});return before.records.length})
  await page.waitForFunction(async before=>{const d=await window.workBuddy.getActivityDay(new Date().toLocaleDateString('en-CA'));return d.records.length>before},result,{timeout:25000})
  await page.evaluate(async()=>{const d=await window.workBuddy.getActivityDay(new Date().toLocaleDateString('en-CA'));await window.workBuddy.configureActivity({...d.status.config,enabled:false})})
  await electron.evaluate(()=>{
    globalThis.__activityAiRequests=[];const original=globalThis.fetch;
    globalThis.fetch=async(url,options)=>{
      if(String(url).includes('generativelanguage.googleapis.com')){globalThis.__activityAiRequests.push(JSON.parse(options.body));return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'Observed coding and documentation activity [E1]. Review time outside timers.'}]}}]}),{status:200,headers:{'Content-Type':'application/json'}})}
      return original(url,options)
    }
  })
  await page.evaluate(async()=>{await window.workBuddy.saveAiKey('fixture-key');const s=await window.workBuddy.getSnapshot();await window.workBuddy.updateSettings({...s.settings,ai:{...s.settings.ai,enabled:true}})})
  await page.getByRole('button',{name:'Переглянути дані для ШІ-підсумку',exact:true}).click()
  await page.getByText('Перегляд перед надсиланням до ШІ',{exact:true}).waitFor()
  assert.equal(await electron.evaluate(()=>globalThis.__activityAiRequests.length),0,'AI is not called before preview approval')
  const taskIdsBefore=await page.evaluate(async()=>(await window.workBuddy.getSnapshot()).tasks.map(t=>t.id))
  await page.getByRole('button',{name:'Надіслати та створити підсумок',exact:true}).click()
  await page.locator('.activity-recap').waitFor();assert.ok((await page.locator('.activity-recap').textContent()).includes('Observed coding and documentation activity [E1]'))
  assert.equal(await electron.evaluate(()=>globalThis.__activityAiRequests.length),1)
  const recap=await page.evaluate(async()=>(await window.workBuddy.getActivityDay(new Date().toLocaleDateString('en-CA'))).recap)
  assert.ok(recap.evidence.length>0,'Saved recap keeps the evidence snapshot')
  assert.deepEqual(await page.evaluate(async()=>(await window.workBuddy.getSnapshot()).tasks.map(t=>t.id)),taskIdsBefore)
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({desktopUI:'passed',nativeCapture:'passed',screenshots:output,profileIsolated:true}))
 }finally{await electron.close()}
})().catch(e=>{console.error(e);process.exitCode=1})



