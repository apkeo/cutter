const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'.local-test','packaged-profile');
async function main(){
 await fs.mkdir(profile,{recursive:true});await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({folder:path.join(profile,'outputs'),shortcut:'Control+Alt+Shift+7'}));
 const app=await electron.launch({executablePath:path.join(root,'release','win-unpacked','Cutter.exe'),args:[],env:{...process.env,CUTTER_TEST_HOME:profile}});
 const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.waitForSelector('#empty-capture');
  await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='test-drop-input';document.body.append(input);});
  await page.locator('#test-drop-input').setInputFiles(path.join(root,'.local-test','sample.png'));
  await page.evaluate(()=>{const file=document.getElementById('test-drop-input').files[0],transfer=new DataTransfer();transfer.items.add(file);document.querySelector('.app-shell').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));document.getElementById('test-drop-input').remove();});
  await page.waitForFunction(()=>document.getElementById('project-name').textContent==='sample');
  await page.locator('#fit-media').click();await page.locator('#radius-value').fill('30');await page.locator('#radius-value').blur();
  await page.locator('#export').click();await page.locator('#render').click();await page.locator('#export-result').waitFor({state:'visible',timeout:30000});const file=await page.locator('#export-filename').textContent();assert.ok((await fs.stat(file)).size>0);
  assert.deepEqual(errors,[]);console.log('PASS: packaged Cutter.exe, actual File drop, bundled FFprobe/FFmpeg, PNG export.');
 }finally{await app.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
