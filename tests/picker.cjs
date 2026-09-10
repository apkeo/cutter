const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
 const root = path.resolve(__dirname, '..');
 const profile = path.join(root, '.local-test', 'picker-move');
 await fs.mkdir(profile, {recursive:true});
 await fs.writeFile(path.join(profile,'settings.json'), JSON.stringify({shortcut:'Control+Alt+Shift+8'}));
 const app = await electron.launch({args:[root],env:{...process.env,CUTTER_TEST_HOME:profile}});
 try {
  const page = await app.firstWindow(); await page.waitForSelector('#empty-capture');
  const opened = app.waitForEvent('window'); await page.evaluate(()=>window.cutter.picker());
  const picker = await opened; await picker.waitForSelector('#selection');
  const nativeBounds = await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes("picker")).getBounds());
  const init = await picker.evaluate(()=>window.cutter.pickerInit());
  const displays = await app.evaluate(({screen})=>screen.getAllDisplays());
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('picker')).length),1);
  for(const d of displays) {assert.ok(nativeBounds.x <= d.bounds.x && nativeBounds.y <= d.bounds.y && nativeBounds.x + nativeBounds.width >= d.bounds.x + d.bounds.width && nativeBounds.y + nativeBounds.height >= d.bounds.y + d.bounds.height, 'Native overlay must cover every display');}
  const target = displays.find(d=>d.id!==init.display.id);
  assert.ok(target, 'This regression test needs two connected displays');
  await app.evaluate(({screen}, bounds)=>{global.testCursor={x:bounds.x+200,y:bounds.y+160};screen.getCursorScreenPoint=()=>global.testCursor;},init.display.bounds);
  const selection = await picker.locator('#selection').boundingBox();
  await picker.mouse.move(selection.x + selection.width / 2, selection.y + selection.height / 2);
  await picker.mouse.down();
  await app.evaluate((_,bounds)=>{global.testCursor={x:bounds.x+250,y:bounds.y+180};},target.bounds);
  for(let i=0;i<100;i++) {
   if((await picker.evaluate(()=>window.cutter.settings())).region?.displayId===target.id) break;
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  const firstRegion = (await picker.evaluate(()=>window.cutter.settings())).region;
  await app.evaluate(()=>{global.testCursor.x += 120; global.testCursor.y += 90;});
  await new Promise(resolve=>setTimeout(resolve,100));
  const continued = (await picker.evaluate(()=>window.cutter.settings())).region;
  assert.ok(continued.x !== firstRegion.x || continued.y !== firstRegion.y, 'Drag must keep moving after crossing the monitor boundary without releasing');
  assert.deepEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('picker')).getBounds()),nativeBounds,'Native bounds stay fixed throughout the drag');
  await picker.mouse.up();
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('picker')).length),1);
  const settings = await picker.evaluate(()=>window.cutter.settings());
  assert.equal(settings.region.displayId,target.id);
  assert.equal(settings.region.width, Math.min(selection.width, target.bounds.width));
  await app.evaluate((_)=>{global.testCursor.x += 60;});
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.deepEqual((await picker.evaluate(()=>window.cutter.settings())).region, settings.region, 'Releasing the pointer must end dragging');
  await picker.evaluate(()=>window.cutter.cancelPicker()).catch(()=>{});
  const reopened = app.waitForEvent('window'); await page.evaluate(()=>window.cutter.picker());
  const next = await reopened; await next.waitForSelector('#selection');
  assert.equal((await next.evaluate(()=>window.cutter.pickerInit())).display.id,target.id);
  console.log('PASS: single picker, cross-monitor movement, saved display and region.');
 } finally {await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

