const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'.local-test','capture-profile');
async function main(){
 await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({folder:path.join(dir,'outputs'),shortcut:'Control+Alt+Shift+8',language:'en',captureFps:24}));
 let app=await electron.launch({args:[root],env:{...process.env,CUTTER_TEST_HOME:dir}});
 let page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.waitForSelector('#empty-capture');
  const target=await app.evaluate(async({BrowserWindow,screen})=>{const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());const b=display.bounds;const target=new BrowserWindow({x:b.x+100,y:b.y+100,width:480,height:320,frame:false,alwaysOnTop:true,backgroundColor:'#336699',webPreferences:{nodeIntegration:false,contextIsolation:true}});await target.loadURL('data:text/html,<body style="margin:0;background:%23336699"></body>');return {displayId:display.id,rect:{x:120,y:120,width:320,height:200},scale:display.scaleFactor};});
  async function picker(){const pending=app.waitForEvent('window');await page.evaluate(()=>window.cutter.picker());await pending;for(let tries=0;tries<30;tries++){for(const p of app.windows()){if(p.url().includes('page=picker')){await p.waitForSelector('#selection');const info=await p.evaluate(()=>window.cutter.pickerInit());if(info.display.id===target.displayId)return p;}}await new Promise(r=>setTimeout(r,100));}throw new Error('Primary display picker not found');}
  let p=await picker();await p.evaluate(data=>window.cutter.capture(data),{rect:target.rect,mode:'screenshot'}).catch(()=>{});
  await page.waitForFunction(()=>document.getElementById('project-name').textContent.startsWith('Screenshot-'),{},{timeout:30000});
  let settings=await page.evaluate(()=>window.cutter.settings());const imageFile=settings.lastFile;assert.ok((await fs.stat(imageFile)).size>0);
  const probe=JSON.parse(execFileSync(require('ffprobe-static').path,['-v','error','-show_streams','-of','json',imageFile],{windowsHide:true}));assert.equal(probe.streams[0].width,Math.round(320*target.scale));assert.equal(probe.streams[0].height,Math.round(200*target.scale));
  const pixel=execFileSync(require('ffmpeg-static'),['-v','error','-i',imageFile,'-vf','crop=1:1:20:20','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true});assert.ok(Math.abs(pixel[0]-51)<=4&&Math.abs(pixel[1]-102)<=4&&Math.abs(pixel[2]-153)<=4,`Capture pixel was ${[...pixel]}`);
  await page.locator('#radius-value').fill('18');await page.locator('#background').fill('#123456');await page.locator('#background').blur();
  p=await picker();const saved=await p.evaluate(()=>window.cutter.pickerInit());assert.deepEqual(saved.settings.region,{...target.rect,displayId:target.displayId});
  await p.evaluate(data=>window.cutter.capture(data),{rect:target.rect,mode:'record'}).catch(()=>{});let control;for(let attempt=0;attempt<100;attempt++){control=app.windows().find(w=>w.url().includes('page=recording'));if(control)break;await new Promise(r=>setTimeout(r,100));}assert.ok(control,'Recording control appeared');await control.waitForSelector('#stop');await new Promise(r=>setTimeout(r,1600));await control.locator('#stop').click().catch(()=>{});
  await page.waitForFunction(()=>document.getElementById('project-name').textContent.startsWith('Recording-'),{},{timeout:30000});settings=await page.evaluate(()=>window.cutter.settings());const recordingFile=settings.lastFile;const recordingInfo=JSON.parse(execFileSync(require('ffprobe-static').path,['-v','error','-show_format','-show_streams','-of','json',recordingFile],{windowsHide:true}));assert.ok(Number(recordingInfo.format.duration)>1);assert.equal(recordingInfo.streams[0].width,Math.round(320*target.scale));
  await page.locator('#settings-nav').click();await page.locator('#setting-language').selectOption('pl');await page.locator('#save-settings').click();await page.waitForFunction(()=>document.documentElement.lang==='pl');
  await new Promise(r=>setTimeout(r,400));await app.close();
  app=await electron.launch({args:[root],env:{...process.env,CUTTER_TEST_HOME:dir}});page=await app.firstWindow();await page.waitForFunction(()=>document.getElementById('project-name')?.textContent.startsWith('Recording-'),{},{timeout:30000});assert.equal(await page.locator('#radius-value').inputValue(),'18');assert.equal(await page.locator('#background').inputValue(),'#123456');assert.equal(await page.locator('#capture').textContent(),'Nowy wycinek');
  assert.deepEqual(errors,[]);console.log('PASS: real screenshot pixels + HiDPI dimensions, recording, region persistence, preferences + last media restored after restart.');
 }finally{await page.evaluate(()=>window.cutter.stop()).catch(()=>{});await new Promise(r=>setTimeout(r,1000));await app.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

