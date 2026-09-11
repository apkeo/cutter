const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
(async () => {
  const root = path.resolve(__dirname, '..'), profile = path.join(root, '.local-test/editor14');
  await fs.mkdir(profile, { recursive: true });
  const video = path.join(profile, 'Seek colors.mp4');
  execFileSync(require('ffmpeg-static'), ['-v','error','-y','-f','lavfi','-i','color=red:s=640x360:r=24','-vf',"drawbox=color=blue:t=fill:enable='gte(t,1)',drawbox=color=green:t=fill:enable='gte(t,2)'",'-t','3','-c:v','libx264','-pix_fmt','yuv420p',video], { windowsHide:true });
  const track = { version:1, nativeVisible:false, visible:false, clicksVisible:false, smooth:false,size:32,samples:[{t:0,x:.1,y:.1,shape:'arrow'},{t:3,x:.8,y:.8,shape:'arrow'}],clicks:[{id:'held',t:1.1,end:1.9,x:.4,y:.4,button:'left'}] };
  await fs.writeFile(video+'.cutter.json',JSON.stringify({version:1,original:track,edited:track}));
  await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({folder:path.join(profile,'captures'),shortcut:'Control+Alt+Shift+4'}));
  const binary = process.platform==='darwin' ? path.join(root,'release',process.arch==='arm64'?'mac-arm64':'mac','Cutter.app/Contents/MacOS/Cutter') : path.join(root,'release/win-unpacked/Cutter.exe');
  const app = await electron.launch({ ...process.argv.includes('--packaged') ? {executablePath:binary,args:[]} : {args:[root]},env:{...process.env,CUTTER_TEST_HOME:profile} });
  try {
    const page = await require('./app-window.cjs')(app); await page.waitForSelector('#empty-capture');
    await page.evaluate(() => { const create=document.createElement.bind(document); document.createElement=(...args)=>{const e=create(...args);if(args[0]==='video')window.video=e;return e;}; });
    const m = await page.evaluate(f=>window.cutter.importFile(f),video);
    await app.evaluate(({BrowserWindow},m)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('page=index')).webContents.send('media',m),m);
    await page.waitForFunction(()=>window.video?.readyState>=2);
    for (const [selector,t,color] of [['#timeline-track',2.5,1],['.movement-events',1.5,2],['.clicks-events',.5,0],['.clicks-events',1.6,2]]) {
      const b=await page.locator(selector).boundingBox();await page.mouse.click(b.x+b.width*t/3,b.y+b.height/2);
      await page.waitForFunction(t=>!window.video.seeking && Math.abs(window.video.currentTime-t)<.035,t);
      const rgb=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.drawImage(window.video,0,0,1,1);return [...x.getImageData(0,0,1,1).data];});
      assert.ok(rgb[color]>100 && rgb[color]>rgb[(color+1)%3]+70,`${selector} actually decodes frame at ${t}: ${rgb}`);
    }
    assert.equal(await page.locator('#cursor-event-time').inputValue(),'1.1','Selecting held click keeps original event time');
    for (const selector of ['#timeline-track','.movement-events','.clicks-events']) {
      const b=await page.locator(selector).boundingBox();await page.mouse.move(b.x+b.width*.2,b.y+12);await page.mouse.down();await page.mouse.move(b.x+b.width*.85,b.y+12,{steps:8});await page.mouse.up();
      await page.waitForFunction(()=>!window.video.seeking && Math.abs(window.video.currentTime-2.55)<.04);
    }
    const before=await page.locator('#canvas-info').textContent();await page.locator('#fit').click();await page.waitForFunction(()=>!!document.fullscreenElement);assert.equal(await page.locator('#canvas-info').textContent(),before);
    await page.locator('#fit').click();await page.waitForFunction(()=>!document.fullscreenElement);
    await page.locator('#fit').click();await page.waitForFunction(()=>!!document.fullscreenElement);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.fullscreenElement);
    assert.equal((await page.evaluate(()=>window.cutter.settings())).minimizeToTray,true);
    await page.evaluate(()=>window.cutter.window('minimize'));
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('page=index')).isVisible()),false);
    const popup=app.windows().find(w=>w.url().includes('page=tray'));assert.ok(popup,'Custom tray window exists');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('page=tray')).show());
    await popup.locator('#tray-open').waitFor();await popup.waitForFunction(()=>!document.querySelector('#tray-copy').disabled);await popup.locator('#tray-copy').click();await popup.waitForFunction(()=>document.querySelector('.feedback').textContent.includes('File copied'));await popup.screenshot({path:path.join(profile,'quick-capture.png')});await popup.locator('#tray-open').click();
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('page=index')).isVisible()),true);
    await page.locator('#settings-nav').click();assert.equal(await page.locator('#setting-tray').isChecked(),true);await page.locator('#setting-tray').uncheck();await page.locator('#save-settings').click();
    assert.equal((await page.evaluate(()=>window.cutter.settings())).minimizeToTray,false);
    await page.evaluate(()=>window.cutter.window('minimize'));
    await new Promise(r=>setTimeout(r,500));
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('page=index')).isMinimized()),true);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('page=index')).restore());
    await page.evaluate(()=>window.cutter.saveSettings({minimizeToTray:true}));
    // Test menu folder dispatch without opening Explorer/Finder on the test runner.
    await app.evaluate(({shell})=>{shell.openPath=async p=>{global.openedCaptures=p;return '';};});
    await page.evaluate(()=>window.cutter.trayAction('folder'));
    assert.equal(await app.evaluate(()=>global.openedCaptures),path.join(profile,'captures'));
    await page.evaluate(()=>window.cutter.trayAction('copy'));
    await page.evaluate(()=>window.cutter.trayAction('capture'));
    await new Promise(r=>setTimeout(r,500));assert.ok(app.windows().some(w=>w.url().includes('page=picker')));
    await page.evaluate(()=>window.cutter.cancelPicker());
    assert.equal(JSON.parse(await fs.readFile(path.join(profile,'settings.json'),'utf8')).minimizeToTray,true);
    console.log('PASS: exact decoded-frame seeking on every lane, held event selection, drag seeking, fullscreen, default tray, restore, disabled tray, quick actions and persistence.');
  } finally { await app.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
