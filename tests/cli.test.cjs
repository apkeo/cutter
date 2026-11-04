const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('ffprobe-static').path;
const { expandVariables, normalizeSpec, parseSpec } = require('../dist/cli/spec.cjs');
const { concatList, motionFps, placeFrames } = require('../dist/cli/frames.cjs');
const { buildComposition, outputFormat } = require('../dist/cli/render.cjs');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'dist', 'cli', 'cutter.cjs');
const work = path.join(root, '.local-test', 'cli');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const runCli = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const probe = (file) =>
  JSON.parse(
    execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {
      encoding: 'utf8',
    }),
  );
const grabFrame = (file, seconds) =>
  execFileSync(
    ffmpeg,
    ['-v', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  );
const minimalStep = { steps: [{ wait: 1 }], url: 'https://example.com' };

test('variables expand from the given map and a missing one fails loudly', () => {
  assert.deepEqual(expandVariables({ a: ['${TOKEN}'], b: 1 }, { TOKEN: 'x' }), { a: ['x'], b: 1 });
  assert.equal(expandVariables('`${lowercase}`', {}), '`${lowercase}`');
  assert.throws(() => expandVariables('${MISSING}', {}), /MISSING is not set/);
});

test('a YAML spec gets defaults for viewport, cursor and timeout', () => {
  const spec = parseSpec(
    `url: \${BASE}/x\nsteps:\n  - click: {testId: save}\n  - press: Alt+M\n`,
    { BASE: 'http://localhost' },
  );
  assert.equal(spec.url, 'http://localhost/x');
  assert.deepEqual(spec.viewport, { width: 1440, height: 900, scale: 2 });
  assert.equal(spec.cursor.size, 24);
  assert.deepEqual(spec.steps[0], {
    action: 'click',
    target: { testId: 'save' },
    duration: undefined,
    button: 'left',
  });
});

test('invalid specs name the step that is wrong', () => {
  const steps = (...list) => ({ ...minimalStep, steps: list });
  assert.throws(() => normalizeSpec(steps({ clik: '.a' })), /Step 1: unknown action "clik"/);
  assert.throws(() => normalizeSpec(steps({ click: { selector: '.a', text: 'b' } })), /exactly one/);
  assert.throws(() => normalizeSpec(steps({ click: { name: 'Save' } })), /exactly one/);
  assert.throws(() => normalizeSpec(steps({ stop: true })), /no recording is running/);
  assert.throws(
    () => normalizeSpec(steps({ record: { name: 'a' } }, { record: { name: 'b' } })),
    /already running/,
  );
  assert.throws(() => normalizeSpec(steps({ screenshot: { name: '../evil' } })), /may only use/);
  assert.throws(
    () => normalizeSpec(steps({ screenshot: { name: 'a' } }, { screenshot: { name: 'a' } })),
    /already used/,
  );
  assert.throws(
    () => normalizeSpec({ ...minimalStep, session: { indexedDb: [{ database: 'a', store: 'b', key: 'c' }] } }),
    /session.origin is required/,
  );
});

test('screencast frames are placed on the wall clock whatever clock they carry', () => {
  const frames = [
    { timestamp: 100, arrived: 1000.02 },
    { timestamp: 100.5, arrived: 1000.52 },
    { timestamp: 101, arrived: 1001.01 },
    { timestamp: 103, arrived: 1003.01 },
  ];
  const placed = placeFrames(frames, 1000.2, 1002);
  assert.deepEqual(
    placed.map((frame) => frame.index),
    [0, 1, 2],
  );
  const total = placed.reduce((sum, frame) => sum + frame.duration, 0);
  assert.ok(Math.abs(total - 1.8) < 1e-6);
  assert.deepEqual(placeFrames([], 0, 1), []);
  assert.equal(motionFps([{ index: 0, duration: 1 / 60 }, { index: 1, duration: 1 / 60 }, { index: 2, duration: 2 }]), 60);
  assert.equal(
    concatList([{ index: 3, duration: 0.5 }], (i) => `f${i}.jpg`),
    "file 'f3.jpg'\nduration 0.5000\nfile 'f3.jpg'",
  );
});

test('presets build a composition and the output extension must match the input', () => {
  const media = { width: 2880, height: 1800, fps: 30, duration: 6, kind: 'video' };
  const clean = buildComposition(media, 'clean', {}, 1920);
  assert.deepEqual([clean.width, clean.height, clean.padding, clean.radius], [1920, 1200, 0, 0]);
  const framed = buildComposition(media, 'framed', { crop: { x: 0, y: 0, width: 1000, height: 500 } });
  assert.deepEqual([framed.width, framed.height, framed.padding], [1128, 628, 64]);
  assert.equal(outputFormat('a.JPEG', 'image'), 'jpg');
  assert.throws(() => outputFormat('a.mp4', 'image'), /cannot be rendered/);
  assert.throws(() => outputFormat('a.xyz', 'video'), /Unsupported/);
});

test('render draws the sidecar cursor into an H.264 file and --no-cursor leaves it out', () => {
  const input = path.join(work, 'source.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input]);
  const track = {
    version: 1,
    nativeVisible: false,
    visible: true,
    clicksVisible: true,
    smooth: false,
    size: 32,
    samples: [
      { t: 0, x: 0.2, y: 0.2, shape: 'arrow' },
      { t: 1, x: 0.8, y: 0.8, shape: 'hand' },
    ],
    clicks: [{ id: 'a', t: 0.4, end: 0.5, button: 'left', x: 0.5, y: 0.5 }],
  };
  fs.writeFileSync(`${input}.cutter.json`, JSON.stringify({ version: 1, original: track, edited: track }));
  const withCursor = path.join(work, 'with-cursor.mp4');
  const withoutCursor = path.join(work, 'without-cursor.mp4');
  const result = runCli('render', input, '--out', withCursor, '--json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).cursor, true);
  assert.equal(runCli('render', input, '--out', withoutCursor, '--no-cursor').status, 0);
  const video = probe(withCursor).streams.find((stream) => stream.codec_type === 'video');
  assert.deepEqual([video.codec_name, video.width, video.height, video.pix_fmt], ['h264', 640, 360, 'yuv420p']);
  assert.notDeepEqual(grabFrame(withCursor, 0.5), grabFrame(withoutCursor, 0.5));
  assert.equal(runCli('render', input, '--out', path.join(work, 'x.png')).status, 1);
});

test('render composes an image on the framed canvas', () => {
  const input = path.join(work, 'source.png');
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=400x200:d=0.1', '-frames:v', '1', input]);
  const output = path.join(work, 'framed.png');
  const result = runCli('render', input, '--preset', 'framed', '--padding', '20', '--out', output, '--json');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual([JSON.parse(result.stdout).width, JSON.parse(result.stdout).height], [440, 240]);
});

test('capture follows a spec: element screenshot, clip and cursor track', (t) => {
  const demo = pathToFileURL(path.join(root, 'docs', 'demo', 'orbit.html')).href;
  const specFile = path.join(work, 'orbit.yaml');
  fs.writeFileSync(
    specFile,
    [
      `url: ${demo}`,
      'viewport: {width: 1280, height: 720, scale: 2}',
      'hide: [".foot"]',
      'steps:',
      '  - waitFor: .hero',
      '  - screenshot: {name: main}',
      '  - screenshot: {name: logo, selector: .logo, padding: 8}',
      '  - record: {name: clip}',
      '  - move: {selector: .logo}',
      '  - click: {text: "Create your space", duration: 400}',
      '  - wait: 300',
      '  - stop: true',
    ].join('\n'),
  );
  const out = path.join(work, 'orbit');
  const result = runCli('capture', '--spec', specFile, '--out', out, '--json');
  if (result.stderr.includes('No browser could start')) return t.skip('no browser on this machine');
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.deepEqual(
    manifest.outputs.map((output) => [output.kind, output.name]),
    [
      ['image', 'main'],
      ['image', 'logo'],
      ['video', 'clip'],
    ],
  );
  const main = probe(path.join(out, 'main.png')).streams[0];
  assert.deepEqual([main.width, main.height], [2560, 1440]);
  const logo = manifest.outputs[1];
  const logoImage = probe(logo.path).streams[0];
  assert.deepEqual([logoImage.width, logoImage.height], [Math.round(logo.rect.width * 2), Math.round(logo.rect.height * 2)]);
  const clip = manifest.outputs[2];
  const video = probe(clip.path).streams.find((stream) => stream.codec_type === 'video');
  assert.deepEqual([video.codec_name, video.width, video.height], ['h264', 2560, 1440]);
  assert.equal(clip.clicks, 1);
  const track = JSON.parse(fs.readFileSync(clip.cursor, 'utf8')).edited;
  assert.equal(track.size, 48);
  assert.equal(track.clicks.length, 1);
  assert.ok(track.samples.length > 5);
  assert.ok(track.samples.every((sample) => sample.t >= 0 && sample.x >= 0 && sample.x <= 1));
  const final = path.join(work, 'orbit-final.mp4');
  const rendered = runCli('render', clip.path, '--max-width', '1280', '--out', final, '--json');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(JSON.parse(rendered.stdout).cursor, true);
  assert.equal(JSON.parse(rendered.stdout).width, 1280);
});

test('capture names the failed step and leaves a screenshot behind', (t) => {
  const demo = pathToFileURL(path.join(root, 'docs', 'demo', 'orbit.html')).href;
  const specFile = path.join(work, 'broken.yaml');
  fs.writeFileSync(
    specFile,
    `url: ${demo}\ntimeout: 500\nsteps:\n  - waitFor: .hero\n  - click: .does-not-exist\n`,
  );
  const out = path.join(work, 'broken');
  const result = runCli('capture', '--spec', specFile, '--out', out);
  if (result.stderr.includes('No browser could start')) return t.skip('no browser on this machine');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Step 2 \(click\) failed/);
  assert.ok(fs.existsSync(path.join(out, 'failure.png')));
});

test('capture --url takes a single element screenshot of any page', (t) => {
  const demo = pathToFileURL(path.join(root, 'docs', 'demo', 'orbit.html')).href;
  const output = path.join(work, 'quick', 'hero.png');
  const result = runCli('capture', '--url', demo, '--selector', '.hero', '--out', output, '--scale', '1');
  if (result.stderr.includes('No browser could start')) return t.skip('no browser on this machine');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.statSync(output).size > 0);
  assert.equal(runCli('capture', '--url', demo, '--out', path.join(work, 'x.txt')).status, 1);
});
