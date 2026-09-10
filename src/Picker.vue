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
      innerWidth - toolbarSize.value.width - 8,
    ) + 'px',
  top:
    (rect.y + rect.height + 12 + toolbarSize.value.height < innerHeight
      ? rect.y + rect.height + 12
      : Math.max(8, rect.y - toolbarSize.value.height - 12)) + 'px',
}));
function normalize() {
  rect.x = clamp(rect.x, 0, innerWidth - 2);
  rect.y = clamp(rect.y, 0, innerHeight - 2);
  rect.width = clamp(rect.width, 2, innerWidth - rect.x);
  rect.height = clamp(rect.height, 2, innerHeight - rect.y);
}
function pointer(e: PointerEvent) {
  if (working.value || e.button !== 0 || toolbar.value?.contains(e.target as Node)) return;
  e.preventDefault();
  const target = e.target as HTMLElement,
    selection = Boolean(target.closest('#selection')),
    handle = target.dataset.handle || '',
    start = { x: e.clientX, y: e.clientY },
    old = { ...rect },
    element = e.currentTarget as HTMLElement;
  element.setPointerCapture(e.pointerId);
  if (!selection) Object.assign(rect, { x: start.x, y: start.y, width: 2, height: 2 });
  element.onpointermove = (ev) => {
    const dx = ev.clientX - start.x,
      dy = ev.clientY - start.y;
    if (!selection)
      Object.assign(rect, {
        x: Math.min(start.x, ev.clientX),
        y: Math.min(start.y, ev.clientY),
        width: Math.abs(dx),
        height: Math.abs(dy),
      });
    else if (!handle)
      Object.assign(rect, {
        ...old,
        x: clamp(old.x + dx, 0, innerWidth - old.width),
        y: clamp(old.y + dy, 0, innerHeight - old.height),
      });
    else {
      let x = old.x,
        y = old.y,
        right = old.x + old.width,
        bottom = old.y + old.height;
      if (handle.includes('w')) x = clamp(old.x + dx, 0, right - 2);
      if (handle.includes('e')) right = clamp(right + dx, x + 2, innerWidth);
      if (handle.includes('n')) y = clamp(old.y + dy, 0, bottom - 2);
      if (handle.includes('s')) bottom = clamp(bottom + dy, y + 2, innerHeight);
      Object.assign(rect, { x, y, width: right - x, height: bottom - y });
    }
    normalize();
  };
  element.onpointerup = element.onpointercancel = () => {
    element.onpointermove = null;
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
onMounted(async () => {
  document.body.classList.add('picker-body');
  document.addEventListener('keydown', keyboard);
  observer = new ResizeObserver(() => {
    if (toolbar.value)
      toolbarSize.value = { width: toolbar.value.offsetWidth, height: toolbar.value.offsetHeight };
  });
  if (toolbar.value) observer.observe(toolbar.value);
  const { settings, display } = await api.pickerInit();
  language.value = settings.language;
  Object.assign(
    rect,
    settings.region?.displayId === display.id
      ? settings.region
      : {
          x: Math.round(innerWidth * 0.2),
          y: Math.round(innerHeight * 0.2),
          width: Math.round(innerWidth * 0.6),
          height: Math.round(innerHeight * 0.5),
        },
  );
  normalize();
});
onUnmounted(() => {
  document.body.classList.remove('picker-body');
  document.removeEventListener('keydown', keyboard);
  observer?.disconnect();
});
</script>

<template>
  <div class="picker-surface" @pointerdown="pointer">
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
      <span class="mini-brand">c</span>
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
.picker-surface {
  position: fixed;
  inset: 0;
  touch-action: none;
}
</style>
