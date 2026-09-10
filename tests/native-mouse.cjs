const {_electron:electron}=require('playwright');const {spawn,execFileSync}=require('node:child_process');const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
(async()=>{
 if(process.platform!=='win32')return;
 const root=path.resolve(__dirname,'..'),profile=path.join(root,'.local-test','native-mouse');await fs.mkdir(profile,{recursive:true});await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({shortcut:'Control+Alt+Shift+4'}));
 const app=await electron.launch({args:[root],env:{...process.env,CUTTER_TEST_HOME:profile}});let helper;
 try{
  const point=await app.evaluate(async({BrowserWindow,screen})=>{const d=screen.getPrimaryDisplay();const w=new BrowserWindow({x:d.bounds.x+120,y:d.bounds.y+120,width:400,height:260,frame:false,alwaysOnTop:true});w.setAlwaysOnTop(true,'screen-saver');await w.loadURL('data:text/html,<body style="margin:0;height:100vh;background:%23336699;cursor:text"></body>');global.mouseFixture=w;return screen.dipToScreenPoint({x:d.bounds.x+220,y:d.bounds.y+220});});
  const events=[];helper=spawn(path.join(root,'dist/native/cursor-helper.exe'),[],{windowsHide:true});let pending='';await new Promise((resolve,reject)=>{helper.on('error',reject);helper.stdout.on('data',data=>{pending+=data;const lines=pending.split('\n');pending=lines.pop()||'';for(const line of lines){const v=JSON.parse(line);if(v.ready)resolve();else events.push(v);}});});
  const script=`Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;public class MouseFixtureInput{[StructLayout(LayoutKind.Sequential)]public struct P{public int x,y;}[DllImport("user32.dll")]public static extern bool GetCursorPos(out P p);[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);}
'@
$p=New-Object MouseFixtureInput+P;[MouseFixtureInput]::GetCursorPos([ref]$p)|Out-Null
try{[MouseFixtureInput]::SetCursorPos(${point.x},${point.y})|Out-Null;Start-Sleep -Milliseconds 80;[MouseFixtureInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 350;[MouseFixtureInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero);[MouseFixtureInput]::mouse_event(8,0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 80;[MouseFixtureInput]::mouse_event(16,0,0,0,[UIntPtr]::Zero);[MouseFixtureInput]::mouse_event(32,0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 80;[MouseFixtureInput]::mouse_event(64,0,0,0,[UIntPtr]::Zero)}finally{[MouseFixtureInput]::SetCursorPos($p.x,$p.y)|Out-Null}`;
  execFileSync('powershell.exe',['-NoProfile','-Command',script],{windowsHide:true});await new Promise(r=>setTimeout(r,100));
  for(const bit of [1,2,4])assert.ok(events.some(e=>e.event==='down'&&(e.buttons&bit)),`Mouse down ${bit} captured`);
  const down=events.find(e=>e.event==='down'&&e.buttons===1),up=events.find(e=>e.event==='up'&&e.ms>down.ms&&e.buttons===0);assert.ok(up.ms-down.ms>=300,'Held left button retains its duration');assert.ok(events.some(e=>e.shape==='text'),'Native I-beam detected');
  await app.evaluate(()=>global.mouseFixture.webContents.executeJavaScript("document.body.style.cursor='pointer'"));execFileSync('powershell.exe',['-NoProfile','-Command',script],{windowsHide:true});await new Promise(r=>setTimeout(r,100));assert.ok(events.some(e=>e.shape==='hand'),'Native hand pointer detected');
  console.log('PASS: real Windows left/right/middle hooks, held duration, I-beam and hand cursor detection.');
 }finally{helper?.kill();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
