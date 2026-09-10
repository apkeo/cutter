const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname,'..'), profile = path.join(root,'.local-test','marketing'), out = path.join(root,'docs','screenshots');
async function main(){
 await fs.mkdir(profile,{recursive:true});await fs.mkdir(out,{recursive:true});
 await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({folder:path.join(profile,'exports'),shortcut:'CommandOrControl+Shift+2',editor:{width:1600,height:1000,padding:100,radius:32,background:'#d7e3d1',fps:30}}));
 const app=await electron.launch({args:[root,'--force-device-scale-factor=1'],env:{...process.env,CUTTER_TEST_HOME:profile}});
 const page=await app.firstWindow();
 try{
 await app.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows()[0];main.setSize(1440,1000);});
 await page.waitForSelector('#empty-capture');await page.screenshot({path:path.join(out,'welcome.png')});
 const windowPromise=app.waitForEvent('window');await app.evaluate(({BrowserWindow},file)=>{const w=new BrowserWindow({width:1280,height:720,useContentSize:true,show:false,webPreferences:{nodeIntegration:false}});w.loadFile(file);},path.join(root,'docs','demo','orbit.html'));const demo=await windowPromise;await demo.waitForSelector('.hero');
 const source=path.join(profile,'Orbit — workspace tour.png');await demo.screenshot({path:source});await demo.close();
 const clip=path.join(profile,'Orbit — workspace tour.mp4');execFileSync(require('ffmpeg-static'),['-v','error','-y','-loop','1','-i',source,'-t','8','-r','30','-c:v','libx264','-pix_fmt','yuv420p',clip],{windowsHide:true});
 const media=await page.evaluate(file=>window.cutter.importFile(file),clip);await app.evaluate(({BrowserWindow},media)=>BrowserWindow.getAllWindows()[0].webContents.send('media',media),media);
 await page.waitForFunction(()=>document.getElementById('project-name').textContent==='Orbit — workspace tour');await page.locator('#start').fill('0.8');await page.locator('#end').fill('6.4');await page.locator('#end').blur();await page.waitForTimeout(200);
 await page.screenshot({path:path.join(out,'editor.png')});
 await page.locator('#crop-tab').click();await page.locator('#crop-x').fill('40');await page.locator('#crop-y').fill('32');await page.locator('#crop-width').fill('1170');await page.locator('#crop-height').fill('645');await page.locator('#crop-height').blur();await page.screenshot({path:path.join(out,'crop.png')});
 console.log('Screenshots created from the real app with an original demo project.');
 }finally{await app.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
