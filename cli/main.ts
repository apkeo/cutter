import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { version } from '../package.json';
import type { Composition } from '../shared/types';
import { capture } from './capture';
import { PRESETS, render, type PresetName } from './render';
import { normalizeSpec, parseSpec } from './spec';

const ffmpeg = require('ffmpeg-static') as string;
const ffprobe = (require('ffprobe-static') as { path: string }).path;

const USAGE = `Cutter ${version}

Usage:
  cutter capture --spec <file> --out <dir> [--var NAME=value] [--json]
  cutter capture --url <url> --out <file.png> [--selector <css>] [--padding <px>]
                 [--wait-for <css>] [--full-page] [--viewport 1440x900] [--scale 2] [--json]
  cutter render <input> --out <file> [--preset clean|framed] [--max-width <px>]
                [--crop x,y,width,height] [--width <px>] [--height <px>] [--padding <px>]
                [--radius <px>] [--background #rrggbb] [--fps <n>] [--start <s>] [--end <s>]
                [--mute] [--cursor <file>] [--no-cursor] [--cursor-size <px>] [--smooth-cursor]
                [--json]

See docs/CLI.md for the spec format.`;

function number(value: string | undefined, label: string) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number.`);
  return parsed;
}

function parseCrop(value: string | undefined) {
  if (value === undefined) return undefined;
  const parts = value.split(',').map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite))
    throw new Error('--crop must be x,y,width,height.');
  const [x, y, width, height] = parts;
  return { x, y, width, height };
}

function parseViewport(value: string | undefined, scale: number | undefined) {
  const match = (value ?? '1440x900').match(/^(\d+)x(\d+)$/);
  if (!match) throw new Error('--viewport must look like 1440x900.');
  return { width: Number(match[1]), height: Number(match[2]), scale: scale ?? 2 };
}

function definedOnly<T extends object>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

async function renderCommand(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      preset: { type: 'string' },
      'max-width': { type: 'string' },
      crop: { type: 'string' },
      width: { type: 'string' },
      height: { type: 'string' },
      padding: { type: 'string' },
      radius: { type: 'string' },
      background: { type: 'string' },
      fps: { type: 'string' },
      start: { type: 'string' },
      end: { type: 'string' },
      mute: { type: 'boolean' },
      cursor: { type: 'string' },
      'no-cursor': { type: 'boolean' },
      'cursor-size': { type: 'string' },
      'smooth-cursor': { type: 'boolean' },
      json: { type: 'boolean' },
    },
  });
  if (positionals.length !== 1) throw new Error('render needs exactly one input file.');
  if (!values.out) throw new Error('render needs --out <file>.');
  const preset = (values.preset ?? 'clean') as PresetName;
  if (!(preset in PRESETS))
    throw new Error(`--preset must be one of: ${Object.keys(PRESETS).join(', ')}.`);
  if (values.background !== undefined && !/^#[da-f]{6}$/i.test(values.background))
    throw new Error('--background must look like #rrggbb.');
  const overrides = definedOnly<Partial<Composition>>({
    crop: parseCrop(values.crop),
    width: number(values.width, '--width'),
    height: number(values.height, '--height'),
    padding: number(values.padding, '--padding'),
    radius: number(values.radius, '--radius'),
    background: values.background,
    fps: number(values.fps, '--fps'),
    start: number(values.start, '--start'),
    end: number(values.end, '--end'),
    muted: values.mute,
  });
  const result = await render(
    {
      input: path.resolve(positionals[0]),
      output: path.resolve(values.out),
      preset,
      overrides,
      maxWidth: number(values['max-width'], '--max-width'),
      cursorFile: values.cursor ? path.resolve(values.cursor) : undefined,
      noCursor: values['no-cursor'] === true,
      cursor: {
        size: number(values['cursor-size'], '--cursor-size'),
        smooth: values['smooth-cursor'] ? true : undefined,
      },
    },
    { ffmpeg, ffprobe },
  );
  console.log(values.json ? JSON.stringify(result, null, 2) : result.path);
}

function parseVariables(entries: string[] = []) {
  const variables: Record<string, string | undefined> = { ...process.env };
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    if (separator < 1) throw new Error(`--var must look like NAME=value, got "${entry}".`);
    variables[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return variables;
}

async function captureCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      spec: { type: 'string' },
      out: { type: 'string' },
      var: { type: 'string', multiple: true },
      url: { type: 'string' },
      selector: { type: 'string' },
      padding: { type: 'string' },
      'wait-for': { type: 'string' },
      'full-page': { type: 'boolean' },
      viewport: { type: 'string' },
      scale: { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  if (!values.out) throw new Error('capture needs --out.');
  if (Boolean(values.spec) === Boolean(values.url))
    throw new Error('capture needs either --spec or --url.');
  const out = path.resolve(values.out);
  if (values.spec) {
    const specPath = path.resolve(values.spec);
    const spec = parseSpec(
      await fs.readFile(specPath, 'utf8'),
      parseVariables(values.var),
      path.dirname(specPath),
    );
    const result = await capture(spec, out, ffmpeg);
    console.log(
      values.json
        ? JSON.stringify(result, null, 2)
        : result.outputs.map((output) => output.path).join('\n'),
    );
    return;
  }
  const extension = path.extname(out).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(extension))
    throw new Error('With --url, --out must be a .png or .jpg file.');
  const name = path.basename(out, path.extname(out));
  const spec = normalizeSpec({
    url: values.url,
    viewport: parseViewport(values.viewport, number(values.scale, '--scale')),
    steps: [
      ...(values['wait-for'] ? [{ waitFor: values['wait-for'] }] : []),
      {
        screenshot: {
          name,
          format: extension === '.png' ? 'png' : 'jpeg',
          padding: number(values.padding, '--padding'),
          fullPage: values['full-page'] === true,
          ...(values.selector ? { selector: values.selector } : {}),
        },
      },
    ],
  });
  const result = await capture(spec, path.dirname(out), ffmpeg);
  console.log(values.json ? JSON.stringify(result, null, 2) : result.outputs[0].path);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }
  if (command === '--version' || command === '-v') {
    console.log(version);
    return;
  }
  if (command === 'render') return renderCommand(args);
  if (command === 'capture') return captureCommand(args);
  throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
}

main().catch((error) => {
  console.error(`cutter: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
