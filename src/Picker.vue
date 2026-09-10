<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import Icon from './components/Icon.vue';
import type { Rect } from '../shared/types';

const api = window.cutter;
const rect = reactive<Rect>({ x: 100, y: 100, width: 640, height: 400 });
const toolbar = ref<HTMLElement>();
const working = ref(false);
const language = ref('en');
const error = ref('');
const hideCursor = ref(false);
async function saveCursorOption() {
  await api.saveSettings({ cursor: !hideCursor.value });
}
const viewport = reactive({ x: 0, y: 0, width: innerWidth, height: innerHeight });
const displayBounds = reactive({ ...viewport });
const surfaceStyle = computed(() => ({
  left: displayBounds.x - viewport.x + 'px',
  top: displayBounds.y - viewport.y + 'px',
  width: displayBounds.width + 'px',
  height: displayBounds.height + 'px',
}));
const toolbarSize = ref({ width: 350, height: 52 });
const handles = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const selectionStyle = computed(() => ({
  left: rect.x + 'px',
  top: rect.y + 'px',
  width: rect.width + 'px',
  height: rect.height + 'px',
}));
const toolbarStyle = computed(() => ({
  left:
    clamp(
      rect.x + rect.width / 2 - toolbarSize.value.width / 2,
      8,
      displayBounds.width - toolbarSize.value.width - 8,
    ) + 'px',
  top:
    (rect.y + rect.height + 12 + toolbarSize.value.height < displayBounds.height
      ? rect.y + rect.height + 12
      : Math.max(8, rect.y - toolbarSize.value.height - 12)) + 'px',
}));
function normalize() {
  rect.x = clamp(rect.x, 0, displayBounds.width - 2);
  rect.y = clamp(rect.y, 0, displayBounds.height - 2);
  rect.width = clamp(rect.width, 2, displayBounds.width - rect.x);
  rect.height = clamp(rect.height, 2, displayBounds.height - rect.y);
}
function pointer(e: PointerEvent) {
  if (working.value || e.button !== 0 || toolbar.value?.contains(e.target as Node)) return;
  e.preventDefault();
  const target = e.target as HTMLElement,
    selection = Boolean(target.closest('#selection')),
    handle = target.dataset.handle || '',
    start = {
      x: e.clientX - displayBounds.x + viewport.x,
      y: e.clientY - displayBounds.y + viewport.y,
    },
    old = { ...rect },
    element = e.currentTarget as HTMLElement;
  element.setPointerCapture(e.pointerId);
  if (selection && !handle) void api.movePicker({ ...rect });
  if (!selection) Object.assign(rect, { x: start.x, y: start.y, width: 2, height: 2 });
  element.onpointermove = (ev) => {
    const localX = ev.clientX - displayBounds.x + viewport.x,
      localY = ev.clientY - displayBounds.y + viewport.y;
    const dx = localX - start.x,
      dy = localY - start.y;
    if (!selection)
      Object.assign(rect, {
        x: Math.min(start.x, localX),
        y: Math.min(start.y, localY),
        width: Math.abs(dx),
        height: Math.abs(dy),
      });
    else if (!handle) return;
    else {
      let x = old.x,
        y = old.y,
        right = old.x + old.width,
        bottom = old.y + old.height;
      if (handle.includes('w')) x = clamp(old.x + dx, 0, right - 2);
      if (handle.includes('e')) right = clamp(right + dx, x + 2, displayBounds.width);
      if (handle.includes('n')) y = clamp(old.y + dy, 0, bottom - 2);
      if (handle.includes('s')) bottom = clamp(bottom + dy, y + 2, displayBounds.height);
      Object.assign(rect, { x, y, width: right - x, height: bottom - y });
    }
    normalize();
  };
  element.onpointerup = element.onpointercancel = () => {
    element.onpointermove = null;
    if (selection && !handle) void api.movePicker(null);
  };
  normalize();
}
async function capture(mode: 'screenshot' | 'record') {
  if (working.value) return;
  working.value = true;
  try {
    await api.capture({ rect: { ...rect }, mode });
  } catch (e) {
    working.value = false;
    error.value = e instanceof Error ? e.message : String(e);
  }
}
function keyboard(e: KeyboardEvent) {
  if (e.key === 'Escape') void api.cancelPicker();
  if (e.key === 'Enter') void capture('screenshot');
}
let observer: ResizeObserver;
const unsubscribe = api.on('picker-region', (moved) => {
  Object.assign(rect, moved.rect);
  Object.assign(displayBounds, moved.bounds);
});
onMounted(async () => {
  document.body.classList.add('picker-body');
  document.addEventListener('keydown', keyboard);
  observer = new ResizeObserver(() => {
    if (toolbar.value)
      toolbarSize.value = { width: toolbar.value.offsetWidth, height: toolbar.value.offsetHeight };
  });
  if (toolbar.value) observer.observe(toolbar.value);
  const { settings, display, viewport: bounds } = await api.pickerInit();
  Object.assign(viewport, bounds);
  Object.assign(displayBounds, display.bounds);
  language.value = settings.language;
  hideCursor.value = !settings.cursor;
  Object.assign(
    rect,
    settings.region?.displayId === display.id
      ? settings.region
      : {
          x: Math.round(displayBounds.width * 0.2),
          y: Math.round(displayBounds.height * 0.2),
          width: Math.round(displayBounds.width * 0.6),
          height: Math.round(displayBounds.height * 0.5),
        },
  );
  normalize();
});
onUnmounted(() => {
  document.body.classList.remove('picker-body');
  document.removeEventListener('keydown', keyboard);
  observer?.disconnect();
  unsubscribe();
});
</script>

<template>
  <div class="picker-surface" :style="surfaceStyle" @pointerdown="pointer">
    <div id="picker-help">
      {{ error || (language === 'pl' ? 'Przeciągnij, aby wybrać obszar' : 'Drag to select an area')
      }}<span>{{ language === 'pl' ? 'Esc — anuluj' : 'Esc to cancel' }}</span>
    </div>
    <div id="selection" :style="selectionStyle">
      <div id="dimensions">{{ Math.round(rect.width) }} × {{ Math.round(rect.height) }}</div>
      <div
        v-for="handle in ['n', 's', 'e', 'w']"
        :key="'edge-' + handle"
        class="edge"
        :data-handle="handle"
      />
      <i v-for="handle in handles" :key="handle" class="resize-handle" :data-handle="handle" />
    </div>
    <div id="picker-tools" ref="toolbar" :style="toolbarStyle">
      <span class="mini-brand">c</span
      ><label class="cursor-option"
        ><input
          id="hide-system-cursor"
          type="checkbox"
          v-model="hideCursor"
          @change="saveCursorOption"
        />{{ language === 'pl' ? 'Ukryj kursor systemowy' : 'Hide system cursor' }}</label
      >
      <button id="screenshot" :disabled="working" @click="capture('screenshot')">
        <Icon name="camera" />{{ language === 'pl' ? 'Zrzut ekranu' : 'Screenshot' }}
      </button>
      <button id="record" :disabled="working" @click="capture('record')">
        <Icon name="record" />{{ language === 'pl' ? 'Nagrywaj' : 'Record' }}
      </button>
      <span class="tool-divider" />
      <button id="cancel" aria-label="Cancel" @click="api.cancelPicker()">
        <Icon name="close" />
      </button>
    </div>
  </div>
</template>

<style lang="scss">
@use './styles/base';
@use './styles/picker';
.cursor-option {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  padding: 0 8px;
  input {
    width: auto;
    accent-color: #c0f28c;
  }
}
.picker-surface {
  position: fixed;
  overflow: hidden;
  touch-action: none;
}
</style>
