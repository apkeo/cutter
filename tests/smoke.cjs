const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, '.local-test');
async function main(){
 await fs.mkdir(dir,{recursive:true});
 const ffmpeg=require('ffmpeg-static');
 const image=path.join(dir,'sample.png'),video=path.join(dir,'sample.mp4');
 execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=24','-frames:v','1',image],{windowsHide:true});
 execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video],{windowsHide:true});
 await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({folder:path.join(dir,'outputs'),shortcut:'Control+Alt+Shift+9'}));
 const app=await electron.launch({args:[root],env:{...process.env,CUTTER_TEST_HOME:dir}});
 const page=await app.firstWindow(); const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('console:',m.text());});
 try {
 await page.waitForSelector('#empty-capture');await page.screenshot({path:path.join(dir,'empty.png')});
 async function importMedia(file){const m=await page.evaluate(file=>window.cutter.importFile(file),file);await app.evaluate(({BrowserWindow},m)=>BrowserWindow.getAllWindows()[0].webContents.send('media',m),m);await page.waitForFunction(name=>document.getElementById('project-name').textContent===name,m.name.replace(/\.[^.]+$/,''));await page.waitForTimeout(150);}
 await importMedia(image);
 await page.locator('#radius-value').fill('24');await page.locator('#width').fill('800');await page.locator('#height').fill('600');
 await page.locator('#crop-tab').click();
 const box=await page.locator('#crop-box').boundingBox();await page.mouse.move(box.x+box.width-1,box.y+box.height-1);await page.mouse.down();await page.mouse.move(box.x+box.width-80,box.y+box.height-50);await page.mouse.up();
 await page.locator('#compose-tab').click();await page.screenshot({path:path.join(dir,'editor.png')});
 await page.locator('#export').click();await page.locator('#render').click();await page.locator('#export-result').waitFor({state:'visible',timeout:60000});
 const exported=await page.locator('#export-filename').textContent();assert.ok((await fs.stat(exported)).size>0);
 await page.evaluate(file=>window.cutter.fileAction('path',file),exported);assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),exported);
 await page.evaluate(file=>window.cutter.fileAction('copy',file),exported);
 const copied=execFileSync('powershell.exe',['-NoProfile','-STA','-Command','Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetFileDropList() | ConvertTo-Json -Compress'],{windowsHide:true,encoding:'utf8'}).trim();assert.equal(JSON.parse(copied),exported);
 const probe=JSON.parse(execFileSync(require('ffprobe-static').path,['-v','error','-show_streams','-of','json',exported],{windowsHide:true}));assert.equal(probe.streams[0].width,800);assert.equal(probe.streams[0].height,600);
 await page.locator('#export-dialog .close-dialog').click();
 for(const format of ['jpg','webp']){await page.locator('#export').click();await page.locator('#export-format').selectOption(format);await page.locator('#render').click();await page.locator('#export-result').waitFor({state:'visible',timeout:30000});assert.ok((await fs.stat(await page.locator('#export-filename').textContent())).size>0);await page.locator('#export-dialog .close-dialog').click();}
 await importMedia(video);
 await page.locator('#fps').fill('60');await page.locator('#fps').blur();assert.equal(await page.locator('#fps').inputValue(),'24');
 await page.locator('#start').fill('0.5');await page.locator('#end').fill('2');
 await page.locator('#play').click();await page.waitForTimeout(400);await page.locator('#play').click();
 for(const format of ['mp4','webm','gif','mov']){
  await page.locator('#export').click();await page.locator('#export-format').selectOption(format);await page.locator('#render').click();await page.locator('#export-result').waitFor({state:'visible',timeout:90000});
  const file=await page.locator('#export-filename').textContent();const info=JSON.parse(execFileSync(require('ffprobe-static').path,['-v','error','-count_frames','-show_streams','-show_format','-of','json',file],{windowsHide:true}));
  const [n,d]=info.streams[0].avg_frame_rate.split('/').map(Number);const duration=Number(info.format.duration)||Number(info.streams[0].nb_read_frames)/(n/d);
  assert.ok(Math.abs(duration-1.5)<.2,`duration ${format}: ${duration}`);if(format!=='gif')assert.ok(info.streams.some(s=>s.codec_type==='audio'));
  await page.locator('#export-dialog .close-dialog').click();console.log('Export passed:',format);
 }
 await page.locator('#settings-nav').click();await page.locator('#setting-language').selectOption('pl');await page.locator('#save-settings').click();await page.waitForFunction(()=>document.getElementById('capture').textContent==='Nowy wycinek');
 const pickerPromise=app.waitForEvent('window');await page.locator('#capture').click();const picker=await pickerPromise;await picker.waitForSelector('#selection');await picker.screenshot({path:path.join(dir,'picker.png')});await picker.keyboard.press('Escape').catch(()=>{});await page.waitForFunction(()=>document.visibilityState==='visible');
 assert.deepEqual(errors,[]);console.log('PASS: import, crop, PNG export, trimmed MP4/WebM/MOV/GIF + audio, FPS cap, language, picker.');
 }finally{await page.evaluate(()=>window.cutter.cancelExport()).catch(()=>{});await app.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
