import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
await build({
  entryPoints: {
    main: 'electron/main.ts',
    preload: 'electron/preload.ts',
    model: 'electron/model.ts',
    crop: 'shared/crop.ts',
    cursor: 'shared/cursor.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outdir: 'dist/electron',
  outExtension: { '.js': '.cjs' },
  external: ['electron', 'ffmpeg-static', 'ffprobe-static', '@napi-rs/canvas'],
});

mkdirSync('dist/native', {recursive:true});
if(process.platform === 'win32') execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/build-native.ps1'],{stdio:'inherit',windowsHide:true});
if(process.platform === 'darwin') for(const name of ['cursor','capture']) execFileSync('xcrun',['swiftc','-O','-framework','AppKit','-framework','ScreenCaptureKit','-framework','AVFoundation',`native/${name}-macos.swift`,'-o',`dist/native/${name}-helper`],{stdio:'inherit'});
