<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import Icon from './Icon.vue';
import { sampleAt, type CursorTrack } from '../../shared/cursor';
const props = defineProps<{
  track: CursorTrack;
  duration: number;
  currentTime: number;
  width: number;
  height: number;
  language: string;
}>();
const emit = defineEmits<{ 'update:track': [CursorTrack]; seek: [number] }>();
const selection = ref<{ kind: 'sample' | 'click'; index: number }>();
const edit = reactive({ t: 0, end: 0, x: 0, y: 0, shape: 'arrow', button: 'left' });
const text = (en: string, pl: string) => (props.language === 'pl' ? pl : en);
const update = (patch: Partial<CursorTrack>) => emit('update:track', { ...props.track, ...patch });
const points = computed(() =>
  props.track.samples.filter(
    (_, i) => i % Math.max(1, Math.ceil(props.track.samples.length / 200)) === 0,
  ),
);
function select(kind: 'sample' | 'click', index: number, seek = true) {
  const value = kind === 'sample' ? props.track.samples[index] : props.track.clicks[index];
  if (!value) return;
  selection.value = { kind, index };
  Object.assign(edit, {
    ...value,
    x: Math.round(value.x * props.width),
    y: Math.round(value.y * props.height),
  });
  if (seek) emit('seek', value.t);
}
function scrub(event: PointerEvent, movement = false) {
  if (event.button !== 0) return;
  event.preventDefault();
  const lane = event.currentTarget as HTMLElement;
  const bounds = lane.getBoundingClientRect();
  const updateTime = (e: PointerEvent) => {
    const t = Math.max(0, Math.min(1, (e.clientX - bounds.left) / bounds.width)) * props.duration;
    emit('seek', t);
  };
  if (movement) pick(event);
  lane.setPointerCapture(event.pointerId);
  updateTime(event);
  lane.onpointermove = updateTime;
  lane.onpointerup = lane.onpointercancel = () => {
    lane.onpointermove = null;
  };
}
function pick(event: PointerEvent) {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const t = ((event.clientX - bounds.left) / bounds.width) * props.duration;
  let index = 0,
    distance = Infinity;
  props.track.samples.forEach((p, i) => {
    if (Math.abs(p.t - t) < distance) {
      distance = Math.abs(p.t - t);
      index = i;
    }
  });
  select('sample', index, false);
}
function commit() {
  const s = selection.value;
  if (!s) return;
  const x = Number(edit.x) / props.width,
    y = Number(edit.y) / props.height,
    t = Math.max(0, Math.min(props.duration, Number(edit.t) || 0));
  if (s.kind === 'sample') {
    const samples = [...props.track.samples];
    const old = samples[s.index];
    if (!old) return;
    samples[s.index] = {
      t: Math.max(
        samples[s.index - 1]?.t || 0,
        Math.min(samples[s.index + 1]?.t ?? props.duration, t),
      ),
      x,
      y,
      shape: edit.shape as 'arrow' | 'text' | 'hand',
    };
    update({ samples });
  } else {
    const clicks = [...props.track.clicks];
    clicks[s.index] = {
      ...clicks[s.index],
      t,
      end: Math.max(t + 0.001, Math.min(props.duration, Number(edit.end))),
      x,
      y,
      button: edit.button as 'left' | 'right' | 'middle',
    };
    const anchor = { ...sampleAt(props.track.samples, t)!, t, x, y };
    update({
      clicks,
      samples: [...props.track.samples.filter((p) => p.t !== t), anchor].sort((a, b) => a.t - b.t),
    });
  }
  emit('seek', t);
}
function remove() {
  const s = selection.value;
  if (!s) return;
  if (s.kind === 'sample' && props.track.samples.length > 1)
    update({ samples: props.track.samples.filter((_, i) => i !== s.index) });
  if (s.kind === 'click') update({ clicks: props.track.clicks.filter((_, i) => i !== s.index) });
  selection.value = undefined;
}
</script>

<template>
  <section class="cursor-timeline" id="cursor-timeline">
    <div class="cursor-layer">
      <button
        id="cursor-eye"
        :title="text('Show/hide cursor', 'Pokaż/ukryj kursor')"
        :aria-pressed="track.visible"
        @click="update({ visible: !track.visible })"
      >
        <Icon :name="track.visible ? 'eye' : 'eye-slash'" />
      </button>
      <span>{{ text('Cursor movement', 'Ruch kursora') }}</span>
      <label
        ><input
          id="cursor-smooth"
          type="checkbox"
          :checked="track.smooth"
          @change="update({ smooth: !track.smooth })"
        />Smooth</label
      >
      <label
        >{{ text('Size', 'Rozmiar') }}
        <input
          id="cursor-size"
          type="number"
          min="8"
          max="128"
          :value="track.size"
          @change="
            update({
              size: Math.max(8, Math.min(128, Number(($event.target as HTMLInputElement).value))),
            })
          "
      /></label>
      <div class="cursor-events movement-events" @pointerdown="scrub($event, true)">
        <div class="cursor-playhead" :style="{ left: (currentTime / duration) * 100 + '%' }" />
        <i
          v-for="(p, i) in points"
          :key="i"
          :style="{ left: (p.t / duration) * 100 + '%' }"
          :title="`${p.t.toFixed(3)}s · ${p.shape} · ${Math.round(p.x * width)}, ${Math.round(p.y * height)}`"
        />
      </div>
    </div>
    <div class="cursor-layer">
      <button
        id="clicks-eye"
        :title="text('Show/hide click effects', 'Pokaż/ukryj efekty kliknięć')"
        :aria-pressed="track.clicksVisible"
        @click="update({ clicksVisible: !track.clicksVisible })"
      >
        <Icon :name="track.clicksVisible ? 'eye' : 'eye-slash'" />
      </button>
      <span>{{ text('Mouse clicks', 'Kliknięcia myszy') }} · {{ track.clicks.length }}</span>
      <div class="cursor-events clicks-events" @pointerdown="scrub($event)">
        <div class="cursor-playhead" :style="{ left: (currentTime / duration) * 100 + '%' }" />
        <button
          v-for="(click, i) in track.clicks"
          :key="click.id"
          class="cursor-click"
          :class="click.button"
          :style="{
            left: (click.t / duration) * 100 + '%',
            width: Math.max(0.7, ((click.end - click.t) / duration) * 100) + '%',
          }"
          :title="`${click.button} · ${click.t.toFixed(3)}–${click.end.toFixed(3)}s`"
          @pointerdown="select('click', i, false)"
          @keydown.enter="select('click', i)"
        >
          {{ click.button[0].toUpperCase() }}
        </button>
      </div>
    </div>
    <div class="cursor-edit" v-if="selection">
      <span
        >{{
          selection.kind === 'click' ? text('Click', 'Kliknięcie') : text('Position', 'Pozycja')
        }}
        #{{ selection.index + 1 }}</span
      >
      <label
        >t
        <input
          id="cursor-event-time"
          type="number"
          step=".001"
          min="0"
          :max="duration"
          v-model.number="edit.t"
          @change="commit"
      /></label>
      <label v-if="selection.kind === 'click'"
        >{{ text('Until', 'Do') }}
        <input
          id="cursor-event-end"
          type="number"
          step=".001"
          v-model.number="edit.end"
          @change="commit"
      /></label>
      <label
        >X <input id="cursor-event-x" type="number" v-model.number="edit.x" @change="commit"
      /></label>
      <label
        >Y <input id="cursor-event-y" type="number" v-model.number="edit.y" @change="commit"
      /></label>
      <select
        v-if="selection.kind === 'sample'"
        id="cursor-shape"
        v-model="edit.shape"
        @change="commit"
      >
        <option value="arrow">Arrow pointer</option>
        <option value="text">I-cursor</option>
        <option value="hand">Hand pointer</option>
      </select>
      <select v-else id="cursor-button" v-model="edit.button" @change="commit">
        <option value="left">Left</option>
        <option value="right">Right</option>
        <option value="middle">Middle</option>
      </select>
      <button @click="select(selection.kind, Math.max(0, selection.index - 1))">←</button
      ><button @click="select(selection.kind, selection.index + 1)">→</button>
      <button @click="remove"><Icon name="close" /></button>
    </div>
    <p v-if="track.nativeVisible" class="cursor-note">
      {{
        text(
          'The original cursor is baked into this recording. Hide the system cursor before recording for a clean replacement.',
          'Oryginalny kursor jest zapisany w obrazie. Ukryj go przed nagrywaniem, aby móc go w pełni zastąpić.',
        )
      }}
    </p>
  </section>
</template>

<style lang="scss" scoped>
.cursor-timeline {
  border-top: 1px solid var(--line);
  padding: 10px 26px;
  background: #141a12;
  flex-shrink: 0;
  max-height: 220px;
  overflow: auto;
}
.cursor-layer {
  display: grid;
  grid-template-columns: 22px 1fr auto auto;
  align-items: center;
  gap: 6px 8px;
  padding: 3px 0;
  font-size: 10px;
  > span {
    width: 125px;
    flex-shrink: 0;
  }
  label {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  input[type='number'] {
    width: 48px;
    padding: 3px;
  }
  input[type='checkbox'] {
    width: auto;
    accent-color: var(--accent);
  }
  button {
    color: var(--accent);
  }
  button[aria-pressed='false'] {
    color: var(--muted);
  }
}
.cursor-events {
  touch-action: none;
  position: relative;
  grid-column: 1 / -1;
  width: 100%;
  height: 24px;
  background: #283521;
  border-radius: 4px;
  min-width: 80px;
  overflow: hidden;
  cursor: crosshair;
}
.cursor-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: white;
  z-index: 3;
  pointer-events: none;
}
.movement-events i {
  position: absolute;
  top: 8px;
  width: 3px;
  height: 8px;
  border-radius: 1px;
  background: #a6cf80;
  pointer-events: none;
}
.cursor-click {
  position: absolute;
  top: 3px;
  height: 18px;
  min-width: 7px;
  font-size: 8px;
  background: #627d48 !important;
  color: white !important;
  overflow: hidden;
  &.right {
    background: #8065a0 !important;
  }
  &.middle {
    background: #4a8193 !important;
  }
}
.cursor-edit {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  flex-wrap: wrap;
  padding: 7px 0;
  label {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  input {
    width: 68px;
    padding: 5px;
  }
  select {
    width: 125px;
    padding: 5px;
  }
}
.cursor-note {
  font-size: 9px;
  color: var(--muted);
  margin: 5px 0 0;
}
</style>
