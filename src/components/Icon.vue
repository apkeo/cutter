<script setup lang="ts">
import { faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
defineProps<{ name: string }>();
const faIcons: Record<string, typeof faEye> = { eye: faEye, 'eye-slash': faEyeSlash };
const paths: Record<string, string> = {
  scan: 'M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3M7 7h10v10H7z',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  settings:
    'm9 3-.5 3-2 1-3-.5-1 3L5 12l-2.5 2.5 1 3 3-.5 2 1 .5 3h6l.5-3 2-1 3 .5 1-3L19 12l2.5-2.5-1-3-3 .5-2-1-.5-3H9Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5',
  export: 'M13 3h8v8m0-8L10 14M10 5H4v15h15v-6',
  maximize: 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6',
  canvas: 'M3 5h18v14H3zM7 2v6M17 16v6',
  crop: 'M6 2v16h16M2 6h16v16',
  palette:
    'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4c-1-1 0-3 2-3h2c4 0 4-11-6-11ZM7 8h.01M12 6h.01M17 8h.01M6 13h.01',
  film: 'M3 4h18v16H3zM7 4v16M17 4v16M3 9h4m-4 6h4M17 9h4m-4 6h4',
  play: 'm8 5 11 7-11 7V5Z',
  pause: 'M8 5v14M16 5v14',
  close: 'm6 6 12 12M6 18 18 6',
  folder: 'M3 7V5h6l2 2h10v13H3V7Z',
  copy: 'M8 8h13v13H8zM16 8V3H3v13h5',
  link: 'm9 15 6-6m-5-3 2-2a5 5 0 0 1 7 7l-2 2M7 11l-2 2a5 5 0 0 0 7 7l2-2',
  sparkles: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  camera: 'M3 7h4l2-3h6l2 3h4v14H3V7Zm13 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  record: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  stop: 'M6 6h12v12H6z',
};
</script>

<template>
  <svg
    :viewBox="faIcons[name] ? `0 0 ${faIcons[name].icon[0]} ${faIcons[name].icon[1]}` : '0 0 24 24'"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path
      v-if="faIcons[name]"
      :d="String(faIcons[name].icon[4])"
      fill="currentColor"
      stroke="none"
    />
    <path v-else :d="paths[name] || paths.layers" />
  </svg>
</template>

<style lang="scss" scoped>
svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
</style>
