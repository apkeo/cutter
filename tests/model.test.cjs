const { test } = require('node:test');
const assert = require('node:assert/strict');
const { composition, classify, exportArgs } = require('../dist/electron/model.cjs');
const media = { path: 'C:\\clips\\a.mp4', width: 1920, height: 1080, fps: 29.97, duration: 12, kind: 'video' };
test('FPS never exceeds the source, including fractional FPS', () => { assert.equal(composition({ fps: 60 }, media).fps, 29.97); });
test('crop cannot cross image boundaries, radius fits rendered crop, trim remains valid', () => {const c = composition({width:400,height:300,padding:20,radius:800,crop:{x:1900,y:1070,width:400,height:400},start:50,end:-1},media);assert.deepEqual(c.crop,{x:1900,y:1070,width:20,height:10});assert.equal(c.radius,90);assert.ok(c.end>c.start);assert.ok(c.end<=12);});
test('bad input is normalized and unknown extensions are rejected', () => {assert.equal(composition({background:'red',width:'bad'},media).background,'#d7e3d1');assert.equal(classify('PHOTO.JPEG'),'image');assert.equal(classify('clip.MOV'),'video');assert.throws(()=>classify('script.exe'));});
test('video export maps original audio and pads odd dimensions for H264', () => {const args=exportArgs(media,composition({width:401,height:301},media),'mp4','bg.png','mask.png','out.mp4');assert.ok(args.includes('0:a?'));assert.ok(args.includes('-ss'));assert.match(args[args.indexOf('-filter_complex')+1],/pad=ceil/);assert.equal(args.at(-1),'out.mp4');});

test('muted exports omit original audio for every video container', () => {for(const format of ['mp4','mov','webm']) {const args=exportArgs(media,composition({muted:true},media),format,'bg','mask','out');assert.ok(args.includes('-an'));assert.ok(!args.includes('0:a?'));}assert.equal(composition({},media).muted,false);});

const {scaleCorners,fitCorners,findEdge}=require('../dist/electron/crop.cjs');
test('corner linking is proportional and zero is deterministic',()=>{assert.deepEqual(scaleCorners([8,16,16,16],0,16,true),[16,32,32,32]);assert.deepEqual(scaleCorners([8,16,16,16],0,16,false),[16,16,16,16]);assert.deepEqual(scaleCorners([0,16,16,16],0,8,true),[8,24,24,24]);assert.deepEqual(fitCorners([80,80,40,40],100,100),[50,50,25,25]);});
test('snap finds a source-pixel edge and ignores flat pixels',()=>{const data=new Uint8ClampedArray(100*60*4);for(let y=0;y<60;y++)for(let x=40;x<100;x++){const i=(y*100+x)*4;data[i]=data[i+1]=data[i+2]=255;}const image={width:100,height:60,data};assert.equal(findEdge(image,'x',43,0,60,6),40);assert.equal(findEdge(image,'x',70,0,60,6),undefined);assert.equal(findEdge(image,'y',30,0,100,6),undefined);});
