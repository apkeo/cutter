<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import Icon from './components/Icon.vue';
import CursorTimeline from './components/CursorTimeline.vue';
import { useEditor, time } from './useEditor';

const {
  cursor,
  cursorSeek,
  magnifier,
  loupe,
  showLoupe,
  hideLoupe,
  guides,
  corners,
  changeCorner,
  api,
  settings,
  composition,
  media,
  stage,
  canvas,
  cropMode,
  busy,
  loading,
  playing,
  currentTime,
  zoom,
  status,
  toastMessage,
  dropActive,
  settingsDialog,
  exportDialog,
  draft,
  settingsError,
  exportError,
  format,
  exportStep,
  progress,
  exported,
  t,
  text,
  isVideo,
  shortcutLabel,
  projectName,
  sourceLabel,
  formats,
  clipStyle,
  cropStyle,
  previewStyle,
  hex,
  guard,
  normalize,
  openMedia,
  capture,
  fitMedia,
  resetCrop,
  preset,
  background,
  play,
  cropPointer,
  trimPointer,
  timelineSeek,
  drop,
  showSettings,
  recordShortcut,
  chooseFolder,
  saveSettings,
  showExport,
  closeExport,
  render,
  fileAction,
} = useEditor();
const fullscreen = ref(false);
const fullscreenTransition = ref(false);
let pendingFullscreenExit = false;
let unsubscribeFullscreen: (() => void) | undefined;
function syncFullscreen() {
  fullscreen.value = !!document.fullscreenElement;
}
async function toggleFullscreen() {
  if (fullscreenTransition.value) return;
  fullscreenTransition.value = api.platform === 'darwin';
  await guard(() =>
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.querySelector<HTMLElement>('.workspace')!.requestFullscreen().catch(error => {
          fullscreenTransition.value = false;
          throw error;
        }),
  );
}
function exitFullscreen(event: KeyboardEvent) {
  if (event.key === 'Escape' && document.fullscreenElement) {
    if (fullscreenTransition.value) pendingFullscreenExit = true;
    else void toggleFullscreen();
  }
}
onMounted(() => {
  unsubscribeFullscreen = api.on('fullscreen-ready', () => {
    fullscreenTransition.value = false;
    if (pendingFullscreenExit) {
      pendingFullscreenExit = false;
      if (document.fullscreenElement) void toggleFullscreen();
    }
  });
  document.addEventListener('fullscreenchange', syncFullscreen);
  document.addEventListener('keydown', exitFullscreen);
});
onUnmounted(() => {
  unsubscribeFullscreen?.();
  document.removeEventListener('fullscreenchange', syncFullscreen);
  document.removeEventListener('keydown', exitFullscreen);
});
const handles = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
</script>

<template>
  <Teleport to="body">
    <div
      id="pixel-loupe"
      v-show="loupe.visible"
      :style="{ left: loupe.left + 'px', top: loupe.top + 'px' }"
    >
      <canvas ref="magnifier" width="204" height="204" />
      <div>
        <span>{{ loupe.x }}, {{ loupe.y }} px</span><span>12×</span>
      </div>
    </div>
  </Teleport>
  <header class="titlebar">
    <div class="brand">
      <span class="brand-mark">c</span> cutter<span class="version">STUDIO</span>
    </div>
    <div class="title-status">
      <span class="status-dot"></span><span>{{ t('local') }}</span>
    </div>
    <div class="window-actions">
      <button @click="api.window('minimize')" aria-label="Minimize">−</button
      ><button @click="api.window('maximize')" aria-label="Maximize">□</button
      ><button @click="api.window('close')" aria-label="Close">×</button>
    </div>
  </header>
  <div class="app-shell" @dragover.prevent @dragenter.prevent="dropActive = true" @drop="drop">
    <nav class="rail">
      <button class="rail-button active" id="editor-nav" title="Editor" @click="cropMode = false">
        <Icon name="layers" /></button
      ><button class="rail-button" id="capture-nav" title="Capture" @click="capture">
        <Icon name="scan" />
      </button>
      <div class="rail-spacer"></div>
      <button class="rail-button" id="settings-nav" title="Settings" @click="showSettings">
        <Icon name="settings" />
      </button>
      <div class="avatar">C</div>
    </nav>
    <main>
      <section class="toolbar">
        <div>
          <div class="eyebrow">{{ t('workspace') }}</div>
          <div class="project-title">
            <h1 id="project-name">{{ projectName }}</h1>
            <span class="pill">{{ t('draft') }}</span>
          </div>
        </div>
        <div class="toolbar-actions">
          <button id="import" class="button" @click="guard(openMedia)" :disabled="loading || busy">
            <Icon name="upload" />{{ t('import') }}</button
          ><button id="capture" class="button" @click="capture" :disabled="loading || busy">
            <Icon name="scan" />{{ t('capture') }}</button
          ><button
            id="export"
            class="button primary"
            @click="showExport"
            :disabled="!media || loading || busy"
          >
            <Icon name="export" />{{ t('export') }}
          </button>
        </div>
      </section>
      <div class="editor-layout">
        <section class="workspace">
          <div class="stage-toolbar">
            <div class="segment">
              <button id="compose-tab" :class="{ selected: !cropMode }" @click="cropMode = false">
                {{ t('composition') }}</button
              ><button
                id="crop-tab"
                @click="cropMode = true"
                :disabled="!media"
                :class="{ selected: cropMode }"
              >
                {{ t('cropSource') }}
              </button>
            </div>
            <label v-if="cropMode" class="snap-toggle"
              ><input id="snap-crop" type="checkbox" v-model="composition.snap" />{{
                text('Snap to edges · Alt to bypass', 'Przyciągaj do krawędzi · Alt wyłącza')
              }}</label
            >
            <div class="stage-info">
              <span id="canvas-info">{{ composition.width }} × {{ composition.height }}</span
              ><span class="separator"></span
              ><span id="zoom">{{ media ? Math.round(zoom * 100) + '%' : 'Fit' }}</span
              ><button
                id="fit"
                class="icon-button"
                :title="
                  fullscreen
                    ? text('Exit fullscreen (Esc)', 'Zamknij pełny ekran (Esc)')
                    : text('Fullscreen preview', 'Podgląd pełnoekranowy')
                "
                :aria-pressed="fullscreen"
                @click="toggleFullscreen"
                :disabled="!media || fullscreenTransition"
              >
                <Icon name="maximize" />
              </button>
            </div>
          </div>
          <div class="stage" id="drop-zone" ref="stage">
            <div class="stage-dots"></div>
            <div id="empty" class="empty-state" v-if="!media">
              <div class="empty-art">
                <div class="art-back"></div>
                <div class="art-front">
                  <span><Icon name="scan" /></span><i></i><i></i><i></i><i></i>
                </div>
                <div class="art-spark">✦</div>
              </div>
              <div class="eyebrow">{{ t('madeFor') }}</div>
              <h2 v-html="t('emptyTitle')" />
              <p>{{ t('emptyText') }}</p>
              <button
                id="empty-capture"
                class="button primary large"
                @click="capture"
                :disabled="loading"
              >
                <Icon name="scan" />{{ t('startCapture') }}
              </button>
              <div class="drop-hint">
                <span>{{ t('orDrop') }}</span
                ><span id="shortcut-hint" class="keycap">{{ shortcutLabel }}</span>
              </div>
              <div class="file-types">MP4 · MOV · WEBM · PNG · JPG · WEBP · GIF</div>
            </div>
            <div id="canvas-wrap" class="canvas-wrap" v-show="media" :style="previewStyle">
              <canvas id="preview" ref="canvas"></canvas>
              <div
                v-if="cropMode && guides.x !== undefined"
                class="snap-guide vertical"
                :style="{ left: (guides.x / media!.width) * 100 + '%' }"
              />
              <div
                v-if="cropMode && guides.y !== undefined"
                class="snap-guide horizontal"
                :style="{ top: (guides.y / media!.height) * 100 + '%' }"
              />
              <div
                id="crop-box"
                v-show="cropMode"
                :style="cropStyle"
                @pointerdown="cropPointer"
                @pointermove="showLoupe"
                @pointerleave="hideLoupe"
              >
                <span class="crop-size"
                  >{{ composition.crop.width }} × {{ composition.crop.height }}</span
                ><i
                  v-for="handle in handles"
                  :key="handle"
                  class="resize-handle"
                  :data-handle="handle"
                />
              </div>
            </div>
            <div class="stage-badge">{{ t('private') }}</div>
            <div id="drop-overlay" v-show="dropActive" @dragleave.prevent="dropActive = false">
              {{ t('drop') }}
            </div>
          </div>
          <div class="playback">
            <button
              id="play"
              class="icon-button"
              title="Play / pause"
              :disabled="!isVideo"
              @click="play"
            >
              <Icon :name="playing ? 'pause' : 'play'" /></button
            ><span id="time-display"
              >{{ time(currentTime) }} <span>/ {{ time(media?.duration || 0) }}</span></span
            ><span id="source-badge" class="muted">{{ sourceLabel }}</span>
          </div>
          <div class="timeline">
            <div class="timeline-head">
              <span class="eyebrow">{{ t('timeline') }}</span>
              <div>
                <span class="muted">{{ t('trimHint') }}</span
                ><span class="keycap">I</span><span class="keycap">O</span>
              </div>
            </div>
            <div class="timeline-ruler" @pointerdown="timelineSeek">
              <span>00:00</span
              ><span id="ruler-quarter">{{ time((media?.duration || 0) * 0.25).slice(0, 5) }}</span
              ><span id="ruler-half">{{ time((media?.duration || 0) * 0.5).slice(0, 5) }}</span
              ><span id="ruler-three">{{ time((media?.duration || 0) * 0.75).slice(0, 5) }}</span
              ><span id="ruler-end">{{ time((media?.duration || 0) * 1).slice(0, 5) }}</span>
            </div>
            <div id="timeline-track" class="timeline-track" @pointerdown="timelineSeek">
              <div id="clip" class="clip" :class="{ loaded: media }" :style="clipStyle">
                <div
                  id="trim-left"
                  class="trim-handle"
                  v-show="isVideo"
                  @pointerdown="trimPointer($event, 'start')"
                ></div>
                <span><Icon name="film" /></span
                ><span id="clip-name">{{ media?.name || t('waiting') }}</span>
                <div
                  id="trim-right"
                  class="trim-handle"
                  v-show="isVideo"
                  @pointerdown="trimPointer($event, 'end')"
                ></div>
              </div>
              <div
                id="playhead"
                class="playhead"
                v-show="isVideo"
                :style="{ left: (currentTime / (media?.duration || 1)) * 100 + '%' }"
              ></div>
            </div>
            <div class="timeline-footer">
              <span id="trim-duration">{{
                isVideo
                  ? time(composition.start) +
                    ' → ' +
                    time(composition.end) +
                    ' · ' +
                    (composition.end - composition.start).toFixed(2) +
                    's'
                  : t('originalSafe')
              }}</span
              ><span>{{ t('autosaved') }}</span>
            </div>
          </div>
          <CursorTimeline
            v-if="cursor && media"
            v-model:track="cursor"
            :duration="media.duration"
            :current-time="currentTime"
            :width="media.width"
            :height="media.height"
            :language="settings.language"
            @seek="cursorSeek"
          />
        </section>
        <aside class="inspector">
          <div class="inspector-title">
            <h3>{{ t('composition') }}</h3>
            <span class="tiny-dot"></span>
          </div>
          <section class="control-section">
            <div class="section-label">
              <span><Icon name="canvas" /></span>
              <h4>{{ t('canvas') }}</h4>
              <span class="unit">PX</span>
            </div>
            <div class="two-cols">
              <label
                ><span>{{ t('width') }}</span
                ><input
                  id="width"
                  type="number"
                  min="16"
                  max="7680"
                  v-model.number="composition.width"
                  @change="normalize" /></label
              ><label
                ><span>{{ t('height') }}</span
                ><input
                  id="height"
                  type="number"
                  min="16"
                  max="7680"
                  v-model.number="composition.height"
                  @change="normalize"
              /></label>
            </div>
            <div class="preset-row">
              <button @click="preset('16:9')">16:9</button
              ><button @click="preset('4:3')">4:3</button><button @click="preset('1:1')">1:1</button
              ><button @click="preset('9:16')">9:16</button>
            </div>
            <button id="fit-media" class="button full subtle" @click="fitMedia" :disabled="!media">
              <Icon name="maximize" />{{ t('fitMedia') }}
            </button>
          </section>
          <section class="control-section">
            <div class="section-label">
              <span><Icon name="crop" /></span>
              <h4>{{ t('frame') }}</h4>
              <button id="reset-crop" class="text-button" @click="resetCrop" :disabled="!media">
                {{ t('reset') }}
              </button>
            </div>
            <div class="slider-label">
              <label for="padding">{{ t('padding') }}</label>
              <div>
                <input
                  id="padding-value"
                  type="number"
                  min="0"
                  max="1000"
                  v-model.number="composition.padding"
                  @change="normalize"
                /><span>px</span>
              </div>
            </div>
            <input
              id="padding"
              type="range"
              min="0"
              max="400"
              v-model.number="composition.padding"
              @change="normalize"
            />
            <div class="slider-label">
              <label>{{ t('radius') }}</label
              ><span>px</span>
            </div>
            <div class="corner-grid">
              <label v-for="(corner, index) in corners" :key="index" :class="'corner-' + index">
                <span>{{
                  [
                    text('Top left', 'Lewy górny'),
                    text('Top right', 'Prawy górny'),
                    text('Bottom right', 'Prawy dolny'),
                    text('Bottom left', 'Lewy dolny'),
                  ][index]
                }}</span>
                <input
                  :id="index === 0 ? 'radius-value' : 'radius-' + index"
                  type="number"
                  min="0"
                  max="2000"
                  step="1"
                  :value="Math.round(corner * 100) / 100"
                  @change="changeCorner(index, Number(($event.target as HTMLInputElement).value))"
                />
              </label>
              <button
                id="link-corners"
                class="corner-link"
                :class="{ active: composition.radiiLinked !== false }"
                :aria-pressed="composition.radiiLinked !== false"
                :title="text('Link corner proportions', 'Połącz proporcje rogów')"
                @click="composition.radiiLinked = composition.radiiLinked === false"
              >
                <Icon name="link" />
              </button>
            </div>
            <div class="crop-fields">
              <label
                >X<input
                  id="crop-x"
                  type="number"
                  min="0"
                  v-model.number="composition.crop.x"
                  :disabled="!media"
                  @change="normalize" /></label
              ><label
                >Y<input
                  id="crop-y"
                  type="number"
                  min="0"
                  v-model.number="composition.crop.y"
                  :disabled="!media"
                  @change="normalize" /></label
              ><label
                >W<input
                  id="crop-width"
                  type="number"
                  min="1"
                  v-model.number="composition.crop.width"
                  :disabled="!media"
                  @change="normalize" /></label
              ><label
                >H<input
                  id="crop-height"
                  type="number"
                  min="1"
                  v-model.number="composition.crop.height"
                  :disabled="!media"
                  @change="normalize"
              /></label>
            </div>
          </section>
          <section class="control-section">
            <div class="section-label">
              <span><Icon name="palette" /></span>
              <h4>{{ t('background') }}</h4>
              <span class="unit">{{ t('solid') }}</span>
            </div>
            <div class="color-input">
              <input
                id="color-picker"
                type="color"
                aria-label="Background color"
                :value="composition.background"
                @input="background(($event.target as HTMLInputElement).value)"
              /><input
                id="background"
                type="text"
                maxlength="7"
                aria-label="Background hex"
                v-model="hex"
                @change="background(hex)"
              /><span>HEX</span>
            </div>
            <div class="swatches">
              <button
                @click="background('#d7e3d1')"
                :class="{ selected: composition.background === '#d7e3d1' }"
                style="--swatch: #d7e3d1"
                aria-label="Sage"
              ></button
              ><button
                @click="background('#c9d7f0')"
                :class="{ selected: composition.background === '#c9d7f0' }"
                style="--swatch: #c9d7f0"
                aria-label="Blue"
              ></button
              ><button
                @click="background('#dbcced')"
                :class="{ selected: composition.background === '#dbcced' }"
                style="--swatch: #dbcced"
                aria-label="Lavender"
              ></button
              ><button
                @click="background('#edc8b5')"
                :class="{ selected: composition.background === '#edc8b5' }"
                style="--swatch: #edc8b5"
                aria-label="Peach"
              ></button
              ><button
                @click="background('#f1e8d8')"
                :class="{ selected: composition.background === '#f1e8d8' }"
                style="--swatch: #f1e8d8"
                aria-label="Cream"
              ></button
              ><button
                @click="background('#ffffff')"
                :class="{ selected: composition.background === '#ffffff' }"
                style="--swatch: #ffffff"
                aria-label="White"
              ></button
              ><button
                @click="background('#181c1a')"
                :class="{ selected: composition.background === '#181c1a' }"
                style="--swatch: #181c1a"
                aria-label="Charcoal"
              ></button>
            </div>
          </section>
          <section class="control-section">
            <div class="section-label">
              <span><Icon name="film" /></span>
              <h4>{{ t('timing') }}</h4>
            </div>
            <div class="two-cols">
              <label
                ><span>{{ t('inPoint') }}</span
                ><input
                  id="start"
                  type="number"
                  min="0"
                  step="0.01"
                  v-model.number="composition.start"
                  @change="normalize"
                  :disabled="!isVideo" /></label
              ><label
                ><span>{{ t('outPoint') }}</span
                ><input
                  id="end"
                  type="number"
                  min="0"
                  step="0.01"
                  v-model.number="composition.end"
                  @change="normalize"
                  :disabled="!isVideo"
              /></label>
            </div>
            <label class="fps-row"
              ><span>{{ t('frameRate') }}</span>
              <div>
                <input
                  id="fps"
                  type="number"
                  min="1"
                  step="0.001"
                  v-model.number="composition.fps"
                  @change="normalize"
                  :disabled="!isVideo"
                  :max="media?.fps || 60"
                /><span>fps</span>
              </div></label
            >
            <p class="field-hint" id="fps-hint">
              {{
                isVideo
                  ? text('Source: ', 'Źródło: ') + media!.fps.toFixed(3) + ' fps'
                  : t('fpsHint')
              }}
            </p>
          </section>
          <section v-if="isVideo" class="control-section">
            <label class="checkbox-row">
              <input
                id="mute-audio"
                type="checkbox"
                v-model="composition.muted"
                :disabled="!media?.hasAudio"
              />
              {{ text('Mute audio', 'Wycisz audio') }}
            </label>
            <p class="field-hint">
              {{
                media?.hasAudio
                  ? text('Applies to preview and export.', 'Dotyczy podglądu i eksportu.')
                  : text('This clip has no audio track.', 'Ten klip nie ma ścieżki audio.')
              }}
            </p>
          </section>
          <div class="inspector-note">
            <span><Icon name="sparkles" /></span>
            <p v-html="t('note')" />
          </div>
        </aside>
      </div>
      <footer class="app-footer">
        <span
          ><span class="status-dot"></span
          ><span id="status">{{
            loading ? text('Preparing media…', 'Przygotowywanie mediów…') : status || t('ready')
          }}</span></span
        ><span>CUTTER <span class="muted">/</span> 1.4</span>
      </footer>
    </main>
  </div>
  <dialog id="settings-dialog" ref="settingsDialog">
    <div class="modal-heading">
      <div>
        <div class="eyebrow">{{ t('makeYours') }}</div>
        <h2>{{ t('settings') }}</h2>
      </div>
      <button class="icon-button close-dialog" @click="settingsDialog?.close()" aria-label="Close">
        <Icon name="close" />
      </button>
    </div>
    <label class="setting"
      ><span>{{ t('shortcut') }}</span
      ><input
        id="setting-shortcut"
        readonly
        placeholder="Click and press a shortcut"
        v-model="draft.shortcut"
        @keydown="recordShortcut"
      /><small>{{ t('shortcutHelp') }}</small></label
    ><label class="setting"
      ><span>{{ t('saveFolder') }}</span>
      <div class="folder-row">
        <input id="setting-folder" readonly :value="draft.folder" /><button
          id="choose-folder"
          class="button"
          @click="guard(chooseFolder)"
        >
          {{ t('browse') }}
        </button>
      </div></label
    >
    <div class="two-cols">
      <label class="setting"
        ><span>{{ t('language') }}</span
        ><select id="setting-language" v-model="draft.language">
          <option value="en">English</option>
          <option value="pl">Polski</option>
        </select></label
      ><label class="setting"
        ><span>{{ t('captureFps') }}</span
        ><select id="setting-fps" v-model.number="draft.captureFps">
          <option>24</option>
          <option>30</option>
          <option>60</option>
        </select></label
      >
    </div>
    <label class="checkbox-row"
      ><input id="setting-cursor" type="checkbox" v-model="draft.cursor" /><span>{{
        t('showCursor')
      }}</span></label
    >
    <label class="checkbox-row"
      ><input id="setting-tray" type="checkbox" v-model="draft.minimizeToTray" /><span>{{
        text('Minimize to tray', 'Minimalizuj do traya')
      }}</span></label
    >
    <p class="field-hint">
      {{
        text(
          'Keep Cutter ready in the system tray or menu bar when minimized.',
          'Po zminimalizowaniu Cutter czeka w zasobniku systemowym lub na pasku menu.',
        )
      }}
    </p>
    <p class="field-hint">{{ t('audioNote') }}</p>
    <p id="settings-error" class="error">{{ settingsError }}</p>
    <button id="save-settings" class="button primary full" @click="saveSettings">
      {{ t('saveSettings') }}
    </button>
  </dialog>
  <dialog id="export-dialog" ref="exportDialog" @cancel="busy && $event.preventDefault()">
    <div class="modal-heading">
      <div>
        <div class="eyebrow">{{ t('finalTouch') }}</div>
        <h2>{{ t('exportComposition') }}</h2>
      </div>
      <button
        class="icon-button close-dialog"
        @click="closeExport"
        :disabled="busy"
        aria-label="Close"
      >
        <Icon name="close" />
      </button>
    </div>
    <div id="export-options" v-show="exportStep === 'options'">
      <label class="setting"
        ><span>{{ t('format') }}</span
        ><select id="export-format" v-model="format">
          <option v-for="f in formats" :key="f" :value="f">
            {{ f.toUpperCase() }}{{ f === 'mp4' ? ' · H.264' : f === 'webm' ? ' · VP9' : '' }}
          </option>
        </select></label
      >
      <div id="export-summary" class="export-summary">
        {{ composition.width }} × {{ composition.height }} px
        <span v-if="isVideo">
          · {{ composition.fps }} fps ·
          {{ (composition.end - composition.start).toFixed(2) }}s</span
        ><br />{{ settings.folder }}
      </div>
      <button id="render" class="button primary full" @click="render">
        <Icon name="export" />{{ t('render') }}
      </button>
    </div>
    <div id="export-progress-panel" v-show="exportStep === 'progress'">
      <div class="progress-orbit"><Icon name="layers" /></div>
      <h3>{{ t('rendering') }}</h3>
      <progress id="export-progress" max="100" :value="progress"></progress>
      <p id="progress-label">{{ Math.round(progress) }}%</p>
      <button id="cancel-export" class="button full" @click="api.cancelExport()">
        {{ t('cancel') }}
      </button>
    </div>
    <div id="export-result" v-show="exportStep === 'result'">
      <div class="success-icon">✓</div>
      <h3>{{ t('exportReady') }}</h3>
      <p id="export-filename">{{ exported?.path }}</p>
      <div class="result-actions">
        <button @click="guard(() => fileAction('path'))" class="button">
          <Icon name="link" />{{ t('copyPath') }}</button
        ><button @click="guard(() => fileAction('copy'))" class="button">
          <Icon name="copy" />{{ t('copyFile') }}</button
        ><button @click="guard(() => fileAction('reveal'))" class="button full">
          <Icon name="folder" />{{ t('reveal') }}
        </button>
      </div>
    </div>
    <p id="export-error" class="error">{{ exportError }}</p>
  </dialog>
  <div id="toast" role="status" v-show="toastMessage">{{ toastMessage }}</div>
</template>

<style lang="scss">
@use './styles/base';
.workspace:fullscreen {
  width: 100vw;
  height: 100vh;
  background: #111312;
  .stage {
    min-height: 0;
  }
}
</style>
