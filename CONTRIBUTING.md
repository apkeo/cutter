# Contributing to Cutter

Thanks for helping make screen capture feel a little more considered.

1. Fork this repository and create a branch for one focused change.
2. Install the runtime with `mise install`, then dependencies with `mise exec -- npm ci`.
3. Keep Vue components in `<script setup lang="ts">`, `<template>`, `<style lang="scss">` order. Use the typed IPC contract in `shared/types.ts`; do not expose Node.js to the renderer.
4. Run `mise exec -- npm run build` and `mise exec -- npm test`. For capture, file or export changes, run the relevant integration tests and describe which operating systems you tested.
5. Open a pull request explaining the problem, changed behavior and verification. Include before/after screenshots for visual changes.

Do not commit local captures, personal file paths, credentials, `.local-test`, packaged binaries, `node_modules` or `.legacy`. Demo media must be original or redistributable.

By contributing, you agree to license your contribution under GPL-3.0-or-later. Please keep unrelated formatting or dependency upgrades in separate pull requests.
