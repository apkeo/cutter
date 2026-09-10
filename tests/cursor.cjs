const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),profile=path.join(root,'.local-test','cursor-test');await fs.mkdir(profile,{recursive:true});
 const source=path.join(profile,'Cursor demo.mp4');execFileSync(require('ffmpeg-static'),['-v','error','-y','-f','lavfi','-i','color=black:size=640x360:rate=24','-t','2','-c:v','libx264','-pix_fmt','yuv420p',source],{windowsHide:true});
 const track={version:1,nativeVisible:false,visible:true,clicksVisible:true,smooth:false,size:40,samples:Array.from({length:61},(_,i)=>({t:i/30,x:.2+i/100,y:.4,shape:i<25?'arrow':i<45?'hand':'text'})),clicks:[{id:'left',t:.4,end:1.2,button:'left',x:.32,y:.4},{id:'right',t:1.4,end:1.55,button:'right',x:.62,y:.4},{id:'middle',t:1.7,end:1.9,button:'middle',x:.71,y:.4}]};
 await fs.writeFile(source+'.cutter.json',JSON.stringify({version:1,original:track,edited:track}));await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({folder:path.join(profile,'exports'),shortcut:'Control+Alt+Shift+5'}));
 const packaged=process.argv.includes('--packaged');const bundle=process.platform==='darwin'?path.join(root,'release',process.arch==='arm64'?'mac-arm64':'mac','Cutter.app','Contents','MacOS'):path.join(root,'release','win-unpacked');
 const binary=path.join(bundle,process.platform==='darwin'?'Cutter':'Cutter.exe');const native=packaged?process.platform==='darwin'?path.join(bundle,'../Resources/app.asar.unpacked/dist/native'):path.join(bundle,'resources/app.asar.unpacked/dist/native'):path.join(root,'dist/native');
 assert.match(execFileSync(path.join(native,process.platform==='win32'?'cursor-helper.exe':'cursor-helper'),['--self-test'],{encoding:'utf8',windowsHide:true}),/cursor-helper-ok/);
 if(process.platform==='darwin')assert.match(execFileSync(path.join(native,'capture-helper'),['--self-test'],{encoding:'utf8'}),/capture-helper-ok/);
 const app=await electron.launch({...packaged?{executablePath:binary,args:[]}:{args:[root]},env:{...process.env,CUTTER_TEST_HOME:profile}});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#empty-capture');const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const media=await page.evaluate(file=>window.cutter.importFile(file),source);assert.equal(media.cursor.samples.length,61);
  await app.evaluate(({BrowserWindow},m)=>BrowserWindow.getAllWindows()[0].webContents.send('media',m),media);await page.waitForSelector('#cursor-timeline');await page.locator('#fit-media').click();
  const videoTrack=await page.locator('#timeline-track').boundingBox();for(const row of await page.locator('.cursor-events').all()){const r=await row.boundingBox();assert.ok(Math.abs(r.x-videoTrack.x)<2,'Cursor rows align with video time');}
  await page.locator('#cursor-smooth').check();await page.locator('.cursor-click.left').click();assert.equal(await page.locator('#cursor-event-end').inputValue(),'1.2');
  await page.locator('#cursor-event-end').fill('1.3');await page.locator('#cursor-event-end').blur();await page.locator('#cursor-event-x').fill('220');await page.locator('#cursor-event-x').blur();
  await page.screenshot({path:path.join(profile,'timeline.png')});
  await page.locator('#export').click();await page.locator('#render').click();await page.locator('#export-result').waitFor({state:'visible',timeout:90000});const output=await page.locator('#export-filename').textContent();
  const raw=execFileSync(require('ffmpeg-static'),['-v','error','-ss','0.4','-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,maxBuffer:4e6});assert.ok(raw.some(v=>v>120),'Export contains rendered cursor pixels');
  const greenAt=(t)=>{const a=execFileSync(require('ffmpeg-static'),['-v','error','-ss',t,'-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,maxBuffer:4e6});let n=0;for(let i=0;i<a.length;i+=3)if(a[i+1]>180&&a[i]<220&&a[i+2]<190)n++;return n;};assert.ok(greenAt('0.95')>greenAt('1.32')+2,'Button highlight lasts until mouse-up and then clears');
  await page.locator('#export-dialog .close-dialog').click();await page.locator('#cursor-eye').click();await page.locator('#clicks-eye').click();
  await page.locator('#export').click();await page.locator('#render').click();await page.locator('#export-result').waitFor({state:'visible',timeout:90000});const hidden=await page.locator('#export-filename').textContent();
  const clean=execFileSync(require('ffmpeg-static'),['-v','error','-ss','0.4','-i',hidden,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,maxBuffer:4e6});const count=(a)=>a.reduce((s,v)=>s+(v>120?1:0),0);assert.ok(count(raw)>count(clean)+100,'Hidden cursor layers disappear from export');
  const saved=JSON.parse(await fs.readFile(source+'.cutter.json','utf8'));assert.equal(saved.edited.smooth,true);assert.equal(saved.edited.clicks[0].end,1.3);assert.equal(saved.original.clicks[0].end,1.2);assert.equal(saved.edited.visible,false);assert.deepEqual(errors,[]);
  console.log('PASS: native helpers, cursor sidecar, timeline edits, smoothing, cursor export, layer visibility, original telemetry preserved.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

