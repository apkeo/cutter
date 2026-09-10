# Third-party notices

Cutter is copyright © 2026 Apkeo and contributors, licensed under GPL-3.0-or-later. The interface icons and Orbit screenshot demo are original assets included under the same license. No proprietary Font Awesome assets are distributed.

## Media tools

Cutter invokes FFmpeg and FFprobe as separate local processes. Their original notices accompany the executables inside the application resources.

- **ffmpeg-static 5.3.0** — GPL-3.0-or-later. [Package source](https://github.com/eugeneware/ffmpeg-static), [binary build release b6.1.1](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1). Platform-specific `*.LICENSE` and `*.README` files describe the binary suppliers and build configuration.
- **FFmpeg** — [source repository](https://github.com/FFmpeg/FFmpeg), [license details](https://ffmpeg.org/legal.html). The Windows 6.1.1 build identifies its source as commit [`e38092ef93`](https://github.com/FFmpeg/FFmpeg/tree/e38092ef93). Build configuration and upstream dependency notices are retained in `ffmpeg.exe.README`.
- **ffprobe-static 3.1.0** — MIT-licensed wrapper, [package and binary sources](https://github.com/joshwnj/ffprobe-static), separately licensed FFprobe binaries. The package's original license is retained in application resources.

## Application libraries

- **Electron** — MIT; Chromium and Node.js have their own notices, shipped in the Electron distribution.
- **Vue** — MIT.
- **Vite, TypeScript, Sass, esbuild, Playwright, electron-builder and mise** — development/build tools with their respective upstream licenses. See `package-lock.json` for the exact dependency tree.

The automatically generated GitHub source archives contain Cutter's complete application source. Binary users can rebuild Cutter using `.tool-versions`, `package-lock.json`, and the checked-in release workflow. Third-party library sources and original license notices are available through the links above and bundled package metadata.
