# Cutter

A Windows and macOS screen capture and composition editor built with **Vue 3.5.42**, **TypeScript**, **Electron 44**, **Vite** and **SCSS**. All media stays on your computer.

## Development

Node is pinned in `.tool-versions` and managed by **mise**. Run commands from this folder:

```powershell
mise install
mise exec -- npm ci
mise exec -- npm run dev
```

In PowerShell profiles that wrap `mise` incorrectly, use `mise.exe` instead. Vue components follow this order:

```vue
<script setup lang="ts">
// Composition API + TypeScript
</script>

<template>
  <!-- View -->
</template>

<style lang="scss">
// Styles
</style>
```

TypeScript is pinned to 6.0.3 because current `vue-tsc` does not support TypeScript 7. Vue uses the current stable release, not a prerelease.

## Build and run

```powershell
mise exec -- npm run build
mise exec -- npm start
mise exec -- npm run pack    # release/win-unpacked/Cutter.exe
mise exec -- npm run dist    # Windows installer in release/
```

FFmpeg and FFprobe ship with the app; users do not need to install them. The app does not require Node or mise once packaged.

## Capture and edit

- **Ctrl+Shift+2** opens the capture picker and stops an active recording. Change it in Settings by clicking the shortcut field and pressing a combination.
- Each monitor has a picker. Drag to draw a region; drag its interior to move it; drag any edge or corner to resize it.
- Choose **Screenshot** or **Record**. Press Escape to cancel. Use the floating Stop control or the capture shortcut to stop recording.
- Captures save immediately under **Videos/Cutter**, before editing. Choose another output folder in Settings.
- Drag a media file from Explorer into the workspace, or use **Import media**.
- **Crop source** exposes eight crop handles. X/Y/W/H fields allow exact source-pixel crop values.
- Canvas width/height, presets, padding, corner radius in output pixels and a six-digit hex background control the composition. **Fit canvas to media** removes padding and matches the current crop.
- For videos, drag the timeline handles or enter in/out seconds. **I** and **O** set points at the playhead. Space toggles playback.
- Composition FPS cannot exceed source FPS, including fractional rates such as 29.97.
- Export saves the rendered composition, then offers **Copy path**, **Copy file** (pasteable into Windows Explorer), and **Show in Explorer**.
- Settings, composition styling, source crop, trim, selected screen region and the last imported/captured file restore on restart. Originals are never overwritten.
- Interface language: **English** (default) and **Polski**.

### Formats

| | Formats |
|---|---|
| Image input | PNG, JPEG, WebP, BMP, TIFF, AVIF |
| Video input | MP4, MOV, WebM, MKV, AVI, M4V, animated GIF |
| Image export | PNG, JPEG, WebP |
| Video export | MP4 / MOV (H.264), WebM (VP9), GIF |

Actual decoding depends on the codec inside a container. Unsupported or damaged files show an error. Less common formats get a cached MP4/PNG preview; export reads the original file. H.264/VP9 exports pad odd canvas dimensions by at most one pixel for codec compatibility. GIF has no audio and uses centisecond timing.

Screen recording captures video only. Existing audio in imported videos is retained for MP4, MOV and WebM exports. Windows uses FFmpeg GDI capture with physical display coordinates. macOS uses Electron screen capture through a sandboxed worker, with crop coordinates scaled to the actual stream size. A region belongs to one monitor. On macOS, grant Screen & System Audio Recording permission and restart Cutter before recording.

## Verification

```powershell
mise exec -- npm run check
mise exec -- npm test
mise exec -- npm run test:smoke
mise exec -- npm run test:capture
```

Smoke tests run a real Electron app with an isolated profile. They cover imports, crop interaction, all output formats, trim duration, retained audio, source FPS limits, Windows clipboard file copying, language selection and the picker. Capture tests create their own solid-color window and verify screenshot pixels, physical dimensions, recording and restart persistence. Tests create files only under `.local-test` plus temporary FFmpeg working directories.

## Code

- `src/Editor.vue`, `Picker.vue`, `Recording.vue`: Vue SFC views.
- `src/useEditor.ts`: reactive editing state, preview and pointer interactions.
- `shared/types.ts`: typed IPC contract shared by Electron and Vue.
- `electron/main.ts`: windows, global shortcuts, capture, file I/O and export.
- `electron/model.ts`: validated composition geometry and FFmpeg arguments.
- `electron/preload.ts`: narrow IPC bridge; renderers are sandboxed with Node disabled.
- `src/styles/`: shared SCSS. Component styles are always the final SFC block.

The application uses original local SVG icons; no proprietary icon fonts are distributed. The public demo and screenshots are original assets.

FFmpeg/FFprobe and other bundled dependencies retain their accompanying license notices. Builds are unsigned and macOS builds are not Apple-notarized until signing credentials are configured. The release workflow builds and import/export-tests native Windows, macOS ARM64 and macOS Intel binaries before publishing a version tag.
