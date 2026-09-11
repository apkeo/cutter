const {_electron: electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'), profile=path.join(root,'.local-test','editor12');
 await fs.mkdir(profile,{recursive:true});await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({folder:path.join(profile,'outputs'),shortcut:'Control+Alt+Shift+6'}));
 const image=path.join(profile,'Edges.png'),video=path.join(profile,'Motion.mp4');
 const ffmpeg=require('ffmpeg-static');
 execFileSync(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=black:s=640x360:r=24','-vf','drawbox=x=120:y=80:w=200:h=140:color=white:t=fill','-frames:v','1',image],{windowsHide:true});
 execFileSync(ffmpeg,['-v','error','-y','-loop','1','-i',image,'-t','3','-r','24','-c:v','libx264','-pix_fmt','yuv420p',video],{windowsHide:true});
 const binary=process.platform==='darwin'?path.join(root,'release',process.arch==='arm64'?'mac-arm64':'mac','Cutter.app','Contents','MacOS','Cutter'):path.join(root,'release','win-unpacked','Cutter.exe');
 const packaged=process.argv.includes('--packaged');
 const app=await electron.launch({...packaged?{executablePath:binary,args:[]}:{args:[root]},env:{...process.env,CUTTER_TEST_HOME:profile}});
 try{
  const page=await require('./app-window.cjs')(app);await page.waitForSelector('#empty-capture');page.on('pageerror',e=>console.error(e));await page.evaluate(()=>{const create=document.createElement.bind(document);document.createElement=(...args)=>{const element=create(...args);if(['img','video'].includes(args[0]))window.decodingMedia=element;return element;};});
  async function load(file){const m=await page.evaluate(file=>window.cutter.importFile(file),file);await app.evaluate(({BrowserWindow},m)=>BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('page=index')).webContents.send('media',m),m);await page.waitForFunction(name=>document.querySelector('#project-name').textContent===name,m.name.replace(/\.[^.]+$/,''));await page.waitForFunction(url=>window.decodingMedia?.src===url && (window.decodingMedia.tagName==='IMG' ? window.decodingMedia.complete : window.decodingMedia.readyState>=2),m.url);}
  async function fill(id,value){await page.locator(id).fill(String(value));await page.locator(id).blur();}
  await load(image);await page.locator('#crop-tab').click();
  const preview=await page.locator('#preview').boundingBox();const handle=await page.locator('#crop-box [data-handle="e"]').boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(preview.x+318*preview.width/640,preview.y+180*preview.height/360);
  await page.locator('#pixel-loupe').waitFor({state:'visible',timeout:3000});
  await page.screenshot({path:path.join(profile,'pixel-loupe.png')});await page.mouse.up();
  await new Promise(r=>setTimeout(r,400));let saved=await page.evaluate(()=>window.cutter.settings());assert.equal(saved.editor.crop.width,320,'Crop snaps exactly to the white rectangle edge');
  await page.locator('#compose-tab').click();await page.locator('#reset-crop').click();await page.locator('#fit-media').click();
  await page.locator('#link-corners').click();await fill('#radius-value',8);for(const id of ['#radius-1','#radius-2','#radius-3'])await fill(id,16);
  await page.locator('#link-corners').click();await fill('#radius-value',16);for(const id of ['#radius-1','#radius-2','#radius-3'])assert.equal(await page.locator(id).inputValue(),'32');
  await page.locator('#link-corners').click();await fill('#radius-value',0);
  await page.locator('#export').click();await page.locator('#render').click();await page.locator('#export-result').waitFor({state:'visible',timeout:60000});
  const output=await page.locator('#export-filename').textContent();await fs.copyFile(output,path.join(profile,'corner-export.png'));const raw=execFileSync(ffmpeg,['-v','error','-i',output,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,maxBuffer:4e6});
  assert.deepEqual([...raw.subarray(0,3)],[0,0,0],'Square top-left corner preserves source');assert.ok([...raw.subarray(639*3,639*3+3)].every((v,i)=>Math.abs(v-[215,227,209][i])<=2),`Rounded top-right reveals background: ${[...raw.subarray(639*3,639*3+3)]}`);
  await page.locator('#export-dialog .close-dialog').click();await load(video);
  await fill('#start',.4);await fill('#end',2.3);assert.equal(await page.locator('#scrub').count(),0);
  const track=await page.locator('#timeline-track').boundingBox();await page.mouse.move(track.x+track.width*.5,track.y+20);await page.mouse.down();await page.mouse.move(track.x+track.width*(2.6/3),track.y+20);await page.mouse.up();await new Promise(r=>setTimeout(r,200));assert.match(await page.locator('#time-display').textContent(),/00:02\.6/);
  await page.locator('#play').click();await new Promise(r=>setTimeout(r,100));await page.locator('#play').click();assert.match(await page.locator('#time-display').textContent(),/00:02\./,'Playback does not jump to the trim start');
  const ruler=await page.locator('.timeline-ruler').boundingBox();await page.mouse.click(track.x+track.width*.5,ruler.y+4);await new Promise(r=>setTimeout(r,100));assert.match(await page.locator('#time-display').textContent(),/00:01\.5/);
  const trim=await page.locator('#trim-right').boundingBox();await page.mouse.move(trim.x+trim.width/2,trim.y+10);await page.mouse.down();await page.mouse.move(track.x+track.width*2/3,trim.y+10);await page.mouse.up();await new Promise(r=>setTimeout(r,100));assert.match(await page.locator('#time-display').textContent(),/00:02\.0/,'Trim release stays at edited boundary');
  await page.locator('#crop-tab').click();const videoBox=await page.locator('#crop-box').boundingBox();await page.mouse.move(videoBox.x+40,videoBox.y+40);await page.locator('#pixel-loupe').waitFor({state:'visible'});
  await new Promise(r=>setTimeout(r,400));const preferences=await page.evaluate(()=>window.cutter.settings());assert.deepEqual(preferences.editor.radii,[0,32,32,32]);assert.equal(preferences.editor.radiiLinked,false);
  console.log('PASS: pixel loupe, exact edge snap, linked corners, exported corner pixels, timeline scrubbing and trim position.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});