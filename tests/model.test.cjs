const { test } = require('node:test');
const assert = require('node:assert/strict');
const { composition, classify, exportArgs } = require('../dist/electron/model.cjs');
const media = { path: 'C:\\clips\\a.mp4', width: 1920, height: 1080, fps: 29.97, duration: 12, kind: 'video' };
test('FPS never exceeds the source, including fractional FPS', () => { assert.equal(composition({ fps: 60 }, media).fps, 29.97); });
test('crop cannot cross image boundaries, radius fits rendered crop, trim remains valid', () => {const c = composition({width:400,height:300,padding:20,radius:800,crop:{x:1900,y:1070,width:400,height:400},start:50,end:-1},media);assert.deepEqual(c.crop,{x:1900,y:1070,width:20,height:10});assert.equal(c.radius,90);assert.ok(c.end>c.start);assert.ok(c.end<=12);});
test('bad input is normalized and unknown extensions are rejected', () => {assert.equal(composition({background:'red',width:'bad'},media).background,'#d7e3d1');assert.equal(classify('PHOTO.JPEG'),'image');assert.equal(classify('clip.MOV'),'video');assert.throws(()=>classify('script.exe'));});
test('video export maps original audio and pads odd dimensions for H264', () => {const args=exportArgs(media,composition({width:401,height:301},media),'mp4','bg.png','mask.png','out.mp4');assert.ok(args.includes('0:a?'));assert.ok(args.includes('-ss'));assert.match(args[args.indexOf('-filter_complex')+1],/pad=ceil/);assert.equal(args.at(-1),'out.mp4');});
