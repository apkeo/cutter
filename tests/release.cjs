const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const profile = path.join(root, '.local-test', 'release-profile');
async function main() {
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ folder: path.join(profile, 'outputs'), shortcut: 'Control+Alt+Shift+7' }));
  const source = path.join(profile, 'Focus session.mp4');
  execFileSync(require('ffmpeg-static'), ['-v','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=24','-f','lavfi','-i','sine=frequency=440','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',source], { windowsHide: true });
  const binary = process.platform === 'darwin' ? path.join(root,'release',process.arch === 'arm64' ? 'mac-arm64' : 'mac','Cutter.app','Contents','MacOS','Cutter') : path.join(root,'release','win-unpacked','Cutter.exe');
  const app = await electron.launch({ executablePath: binary, args: [], env: { ...process.env, CUTTER_TEST_HOME: profile } });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.waitForSelector('#empty-capture');
    await page.evaluate(() => { const create = document.createElement.bind(document); document.createElement = (...args) => { const element = create(...args); if(args[0] === 'video') window.testVideo = element; return element; }; });
    const media = await page.evaluate(file => window.cutter.importFile(file), source);
    await app.evaluate(({ BrowserWindow }, media) => BrowserWindow.getAllWindows()[0].webContents.send('media', media), media);
    await page.waitForFunction(() => document.getElementById('project-name').textContent === 'Focus session');
    await page.locator('#fit-media').click();
    await page.locator('#start').fill('0.25');await page.locator('#end').fill('1.5');await page.locator('#end').blur();
    for (const format of ['mp4','mov','webm','gif']) {
      await page.locator('#export').click();await page.locator('#export-format').selectOption(format);await page.locator('#render').click();
      await page.locator('#export-result').waitFor({ state: 'visible', timeout: 90000 });
      const output = await page.locator('#export-filename').textContent();assert.ok((await fs.stat(output)).size > 1000);
      await page.locator('#export-dialog .close-dialog').click();
    }
    assert.equal(media.hasAudio, true);
    assert.equal(await page.evaluate(()=>window.testVideo.muted), false);
    await page.locator('#mute-audio').check();
    await page.waitForFunction(()=>window.testVideo.muted === true);
    for (const format of ['mp4', 'mov', 'webm']) {
      await page.locator('#export').click(); await page.locator('#export-format').selectOption(format); await page.locator('#render').click();
      await page.locator('#export-result').waitFor({ state: 'visible', timeout: 90000 });
      const output = await page.locator('#export-filename').textContent();
      const probe = JSON.parse(execFileSync(require('ffprobe-static').path, ['-v','error','-show_streams','-of','json',output], {windowsHide:true}));
      assert.ok(probe.streams.some(s => s.codec_type === 'video'));
      assert.ok(!probe.streams.some(s => s.codec_type === 'audio'), format + ' must contain no audio');
      await page.locator('#export-dialog .close-dialog').click();
    }
    let stored;
    for(let i=0;i<40;i++){stored=JSON.parse(await fs.readFile(path.join(profile,'settings.json'),'utf8'));if(stored.editor?.muted===true)break;await new Promise(r=>setTimeout(r,50));}
    assert.equal(stored.editor.muted,true, 'Mute preference is persisted');
    await page.locator('#mute-audio').uncheck();
    await page.waitForFunction(()=>window.testVideo.muted === false);
    await page.screenshot({ path: path.join(profile, 'verified.png') });
    assert.deepEqual(errors, []);
    console.log(`PASS packaged ${process.platform}/${process.arch}: bundled media tools, video import, MP4/MOV/WebM/GIF exports.`);
  } catch (error) { await page.screenshot({ path: path.join(profile, 'failure.png') }).catch(()=>{});console.error(await page.locator('#export-error').textContent().catch(()=>''));throw error; }
  finally { await page.evaluate(()=>window.cutter.cancelExport()).catch(()=>{});await app.close(); }
}
main().catch(error => { console.error(error);process.exitCode = 1; });
