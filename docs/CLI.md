# Cutter CLI

Two commands that work without a window, a desktop or a person at the keyboard. `capture` drives a headless browser and records what a spec describes. `render` runs the same composition and export code as the studio.

```sh
mise exec -- npm ci
mise exec -- node scripts/build.mjs
mise exec -- node dist/cli/cutter.cjs --help
```

`npm link` puts `cutter` on your path. The browser comes from Playwright: Cutter tries its Chromium, then system Chrome, then Edge. On a clean machine or in CI run `npx playwright-core install --with-deps chromium`.

The screen recording in the studio is not used here. It needs a real desktop and operating system permissions, so it cannot run on a server.

## Quick screenshot of any page

```sh
cutter capture --url https://example.com --out page.png
cutter capture --url https://example.com --selector "main h1" --padding 16 --out title.png
cutter capture --url https://example.com --full-page --viewport 1280x800 --scale 1 --out full.jpg
```

## capture --spec

```sh
cutter capture --spec scenario.yaml --out ./raw [--var NAME=value] [--json]
```

Writes one file per `screenshot` and `record` step, plus `capture.json` listing them. A clip comes with `<clip>.mp4.cutter.json`, the same cursor file the studio writes, so `render` or the studio can draw the pointer and clicks later. Headless browsers show no pointer, so the video itself stays clean.

If a step fails, the exit code is 1, the error names the step and `failure.png` shows the page at that moment.

```yaml
url: https://app.example.com/board
viewport: {width: 1440, height: 900, scale: 2}
locale: en-US
colorScheme: light
testIdAttribute: data-cy
hide: [".environment-badge", ".toast"]
clock: "2026-11-04T10:00:00Z"
session:
  origin: https://app.example.com
  settle: 3000
  blockRequests: ["**/api/auth/session"]
  indexedDb:
    - {database: localforage, store: keyvaluepairs, key: auth-token, value: "${AUTH_TOKEN}"}
steps:
  - waitFor: {testId: board, timeout: 60000}
  - screenshot: {name: board-header, selector: ".board-header", padding: 24}
  - record: {name: add-card, fps: 30}
  - click: {testId: add-card}
  - type: {testId: card-title, text: "Prepare the release notes", submit: true}
  - wait: 800
  - stop: true
```

`${NAME}` is replaced from `--var` and then from the environment, and a missing variable stops the run. Keep secrets in the environment: command line arguments can be read by other processes.

### Top-level fields

| Field | Default | Meaning |
| --- | --- | --- |
| `url` | required | First page to open |
| `viewport` | `1440×900`, scale `2` | CSS size and device scale; images and clips come out at width × scale |
| `browser` | headless | `channel` (`chrome`, `msedge`) and `headless` |
| `locale`, `timezone`, `colorScheme` | browser default | Passed to the browser context |
| `clock` | real time | Freezes `Date` so relative times stay the same between takes |
| `timeout` | `15000` | Milliseconds each step may wait |
| `testIdAttribute` | `data-testid` | Attribute behind `testId` targets |
| `hide`, `css` | none | Selectors hidden and CSS added on every page |
| `initScript` | none | Script that runs before the page's own scripts |
| `cursor` | size `24`, visible, clicks | `size` in CSS pixels, `visible`, `clicks`, `smooth` |
| `session` | none | `origin`, `settle`, `indexedDb`, `localStorage`, `cookies`, `storageState`, `blockRequests` |

`session.origin` is opened first and waits `settle` milliseconds, so values written to `indexedDb` or `localStorage` are in place before `url` loads.

### Targets

A string is a CSS selector. An object uses exactly one of these:

| Target | Example |
| --- | --- |
| `selector` | `{selector: ".modal"}` |
| `testId` | `{testId: save-button}` |
| `role` with optional `name` | `{role: button, name: "Allow once"}` |
| `text` with optional `exact` | `{text: "Templates", exact: true}` |
| `expression` | `{expression: "window.board.cellRect('a', 'b')"}`, returning `{x, y, width, height}`, for canvas UIs with no DOM element |

Prefer stable attributes. Text breaks when the copy changes, and class names break when the styles change.

### Steps

| Step | Example | Notes |
| --- | --- | --- |
| `goto` | `goto: /settings` | Relative to the current page |
| `wait` | `wait: 500` | Milliseconds |
| `waitFor` | `waitFor: {selector: .modal, state: hidden, timeout: 5000}` | `state` is `visible` or `hidden`; an `expression` waits until it is truthy |
| `move` | `move: {testId: menu, duration: 500}` | Glides while recording, jumps otherwise |
| `click` | `click: {testId: save, button: left}` | Waits until the element can be clicked, glides, then presses |
| `type` | `type: {testId: title, text: "Hello", delay: 35, submit: true}` | Clicks the target first, if there is one; `submit` presses Enter |
| `press` | `press: Alt+M` | One key combination |
| `scroll` | `scroll: {y: 600, duration: 500}` | Wheel scroll, over a target if given |
| `eval` | `eval: "window.app.ready()"` | Runs in the page |
| `screenshot` | `screenshot: {name: panel, selector: .panel, padding: 24}` | `targets: [...]` frames several elements; `fullPage`, `format: jpeg` |
| `record` | `record: {name: clip, fps: 30}` | Starts a clip |
| `stop` | `stop: true` | Ends the clip |

`name` becomes the file name, so it may only contain letters, digits, `.`, `_` and `-`.

## render

```sh
cutter render clip.mp4 --max-width 1920 --out final.mp4
cutter render shot.png --preset framed --radius 32 --background "#d7e3d1" --out final.png
```

The output format comes from the `--out` extension: `mp4`, `mov`, `webm`, `gif` for video, `png`, `jpg`, `webp` for images.

| Option | Meaning |
| --- | --- |
| `--preset clean` | Default. No padding, corners or background: the source as it is |
| `--preset framed` | Padding `64`, radius `24`, background `#d7e3d1` |
| `--max-width` | Scales the canvas down to this width, keeping proportions |
| `--crop x,y,w,h` | Source crop in source pixels |
| `--width`, `--height`, `--padding`, `--radius`, `--background` | Override the preset |
| `--fps`, `--start`, `--end`, `--mute` | Timing and audio. FPS never exceeds the source |
| `--cursor <file>` | Cursor file. By default `<input>.cutter.json` is used when it exists |
| `--no-cursor`, `--cursor-size`, `--smooth-cursor` | Leave the pointer out, or override its size and smoothing |
| `--json` | Print path, format, size and duration as JSON |

## Tests

```sh
mise exec -- npm run test:cli
```

Browser tests skip themselves when no browser can start. Everything is written under `.local-test`.
