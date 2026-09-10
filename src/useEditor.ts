import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue';
import type { Composition, Media, Rect, Settings, ExportResult } from '../shared/types';
import { en, pl } from './i18n';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const number = (value: unknown, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
export const time = (value: number) =>
  `${String(Math.floor(Math.max(0, value) / 60)).padStart(2, '0')}:${(Math.max(0, value) % 60).toFixed(2).padStart(5, '0')}`;
const defaults: Composition = {
  width: 1920,
  height: 1080,
  padding: 64,
  radius: 8,
  background: '#d7e3d1',
  fps: 30,
  crop: { x: 0, y: 0, width: 1920, height: 1080 },
  start: 0,
  end: 0,
};

export function useEditor() {
  const api = window.cutter;
  const settings = reactive<Settings>({
    shortcut: 'CommandOrControl+Shift+2',
    folder: '',
    language: 'en',
    captureFps: 30,
    cursor: true,
    editor: { ...defaults },
  });
  const composition = reactive<Composition>({ ...defaults, crop: { ...defaults.crop } });
  const media = shallowRef<Media>();
  const source = shallowRef<HTMLImageElement | HTMLVideoElement>();
  const stage = ref<HTMLElement>();
  const canvas = ref<HTMLCanvasElement>();
  const cropMode = ref(false);
  const busy = ref(false);
  const loading = ref(false);
  const playing = ref(false);
  const currentTime = ref(0);
  const zoom = ref(1);
  const status = ref('');
  const toastMessage = ref('');
  const dropActive = ref(false);
  const settingsDialog = ref<HTMLDialogElement>();
  const exportDialog = ref<HTMLDialogElement>();
  const draft = reactive({
    shortcut: '',
    folder: '',
    language: 'en' as Settings['language'],
    captureFps: 30,
    cursor: true,
  });
  const settingsError = ref('');
  const exportError = ref('');
  const format = ref('mp4');
  const exportStep = ref<'options' | 'progress' | 'result'>('options');
  const progress = ref(0);
  const exported = ref<ExportResult>();
  let initialized = false,
    saveTimer: ReturnType<typeof setTimeout>,
    toastTimer: ReturnType<typeof setTimeout>,
    animation = 0,
    observer: ResizeObserver;
  const disposers: (() => void)[] = [];
  const t = (key: string) =>
    key === 'reveal' && api.platform === 'darwin'
      ? settings.language === 'pl'
        ? 'Pokaż w Finderze'
        : 'Show in Finder'
      : (settings.language === 'pl' ? pl[key] : en[key]) || en[key] || key;
  const text = (english: string, polish: string) => (settings.language === 'pl' ? polish : english);
  const isVideo = computed(() => media.value?.kind === 'video');
  const shortcutLabel = computed(() =>
    settings.shortcut
      .replace('CommandOrControl', api.platform === 'darwin' ? '⌘' : 'Ctrl')
      .replace('Shift', '⇧'),
  );
  const projectName = computed(() => media.value?.name.replace(/\.[^.]+$/, '') || t('untitled'));
  const sourceLabel = computed(() =>
    media.value
      ? `${media.value.width} × ${media.value.height} · ${isVideo.value ? media.value.fps.toFixed(2) + ' fps' : media.value.name.split('.').pop()?.toUpperCase()}`
      : t('noMedia'),
  );
  const formats = computed(() =>
    isVideo.value ? ['mp4', 'mov', 'webm', 'gif'] : ['png', 'jpg', 'webp'],
  );
  const clipStyle = computed(() =>
    isVideo.value
      ? {
          left: (composition.start / media.value!.duration) * 100 + '%',
          right: (1 - composition.end / media.value!.duration) * 100 + '%',
        }
      : {},
  );
  const cropStyle = computed(() =>
    media.value
      ? {
          left: (composition.crop.x / media.value.width) * 100 + '%',
          top: (composition.crop.y / media.value.height) * 100 + '%',
          width: (composition.crop.width / media.value.width) * 100 + '%',
          height: (composition.crop.height / media.value.height) * 100 + '%',
        }
      : {},
  );
  const previewStyle = computed(() => ({
    width: ((cropMode.value ? media.value?.width : composition.width) || 1) * zoom.value + 'px',
    height: ((cropMode.value ? media.value?.height : composition.height) || 1) * zoom.value + 'px',
  }));
  const hex = ref(composition.background);

  function toast(message: string) {
    toastMessage.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastMessage.value = ''), 6500);
  }
  function report(error: unknown) {
    toast(error instanceof Error ? error.message : String(error));
    status.value = '';
  }
  async function guard<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      report(e);
    }
  }
  function normalize() {
    composition.width = Math.round(clamp(number(composition.width, 1920), 16, 7680));
    composition.height = Math.round(clamp(number(composition.height, 1080), 16, 7680));
    composition.padding = clamp(
      number(composition.padding, 64),
      0,
      Math.min(composition.width, composition.height) / 2 - 1,
    );
    composition.radius = clamp(number(composition.radius, 8), 0, 2000);
    composition.fps = clamp(number(composition.fps, 30), 1, media.value?.fps || 60);
    if (media.value) {
      const m = media.value,
        c = composition.crop;
      c.x = Math.round(clamp(number(c.x), 0, m.width - 1));
      c.y = Math.round(clamp(number(c.y), 0, m.height - 1));
      c.width = Math.round(clamp(number(c.width, m.width), 1, m.width - c.x));
      c.height = Math.round(clamp(number(c.height, m.height), 1, m.height - c.y));
      if (isVideo.value) {
        composition.start = clamp(number(composition.start), 0, m.duration - 0.01);
        composition.end = clamp(
          number(composition.end, m.duration),
          composition.start + 0.01,
          m.duration,
        );
      }
    }
  }
  function snapshot(): Composition {
    return JSON.parse(JSON.stringify(composition)) as Composition;
  }
  function persist() {
    if (!initialized) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(
      () =>
        guard(async () => {
          await api.saveSettings({ editor: snapshot() });
        }),
      300,
    );
  }
  function geometry() {
    const c = composition.crop,
      s = Math.min(
        (composition.width - composition.padding * 2) / c.width,
        (composition.height - composition.padding * 2) / c.height,
      );
    const w = Math.max(1, Math.round(c.width * s)),
      h = Math.max(1, Math.round(c.height * s));
    return {
      w,
      h,
      x: (composition.width - w) / 2,
      y: (composition.height - h) / 2,
      r: Math.min(composition.radius, w / 2, h / 2),
    };
  }
  function draw() {
    const m = media.value,
      s = source.value,
      view = canvas.value,
      bounds = stage.value?.getBoundingClientRect();
    if (!m || !s || !view || !bounds) return;
    const w = cropMode.value ? m.width : composition.width,
      h = cropMode.value ? m.height : composition.height;
    zoom.value = Math.max(0.001, Math.min((bounds.width - 68) / w, (bounds.height - 62) / h, 1));
    const resolution = Math.min(1, Math.max(0.1, zoom.value) * devicePixelRatio),
      pw = Math.round(w * resolution),
      ph = Math.round(h * resolution);
    if (view.width !== pw || view.height !== ph) {
      view.width = pw;
      view.height = ph;
    }
    const ctx = view.getContext('2d')!;
    ctx.setTransform(pw / w, 0, 0, ph / h, 0, 0);
    ctx.clearRect(0, 0, w, h);
    try {
      if (cropMode.value) ctx.drawImage(s, 0, 0, w, h);
      else {
        ctx.fillStyle = composition.background;
        ctx.fillRect(0, 0, w, h);
        const g = geometry(),
          c = composition.crop,
          sx = s instanceof HTMLVideoElement ? s.videoWidth / m.width : s.naturalWidth / m.width,
          sy =
            s instanceof HTMLVideoElement ? s.videoHeight / m.height : s.naturalHeight / m.height;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(g.x, g.y, g.w, g.h, g.r);
        ctx.clip();
        ctx.drawImage(s, c.x * sx, c.y * sy, c.width * sx, c.height * sy, g.x, g.y, g.w, g.h);
        ctx.restore();
      }
    } catch {
      /* A decoded video frame is not ready yet. */
    }
  }
  function stopPlayback() {
    if (source.value instanceof HTMLVideoElement) source.value.pause();
    playing.value = false;
  }
  function animate() {
    if (source.value instanceof HTMLVideoElement && !source.value.paused) {
      currentTime.value = source.value.currentTime;
      if (currentTime.value >= composition.end) {
        stopPlayback();
        seek(composition.start);
      }
      draw();
    }
    animation = requestAnimationFrame(animate);
  }
  async function loadMedia(m: Media | undefined, restore = false) {
    if (!m) return;
    stopPlayback();
    source.value = undefined;
    media.value = m;
    cropMode.value = false;
    const saved = { ...settings.editor, crop: { ...settings.editor.crop } };
    composition.crop = { x: 0, y: 0, width: m.width, height: m.height };
    composition.start = 0;
    composition.end = m.duration;
    if (restore) {
      composition.crop = saved.crop;
      composition.start = saved.start;
      composition.end = saved.end || m.duration;
    }
    normalize();
    const element = document.createElement(m.kind === 'video' ? 'video' : 'img');
    if (element instanceof HTMLVideoElement) {
      element.preload = 'auto';
      element.playsInline = true;
    }
    await new Promise<void>((resolve, reject) => {
      element.addEventListener(m.kind === 'video' ? 'loadeddata' : 'load', () => resolve(), {
        once: true,
      });
      element.addEventListener(
        'error',
        () =>
          reject(new Error(text('Cannot display this media.', 'Nie można wyświetlić tego pliku.'))),
        { once: true },
      );
      element.src = m.url;
    });
    source.value = element;
    currentTime.value = 0;
    if (element instanceof HTMLVideoElement) {
      element.addEventListener('seeked', () => {
        currentTime.value = element.currentTime;
        draw();
      });
      element.addEventListener('ended', () => {
        playing.value = false;
      });
      if (composition.start) element.currentTime = composition.start;
    }
    status.value = '';
    await nextTick();
    draw();
    persist();
  }
  async function importFile(file: string, restore = false) {
    if (loading.value) return;
    loading.value = true;
    status.value = text('Preparing media…', 'Przygotowywanie mediów…');
    try {
      await loadMedia(await api.importFile(file), restore);
    } finally {
      loading.value = false;
      status.value = '';
    }
  }
  async function openMedia() {
    if (loading.value || busy.value) return;
    loading.value = true;
    try {
      await loadMedia(await api.open());
    } finally {
      loading.value = false;
    }
  }
  function capture() {
    if (!busy.value && !loading.value) void guard(() => api.picker());
  }
  function fitMedia() {
    if (!media.value) return;
    composition.width = composition.crop.width;
    composition.height = composition.crop.height;
    composition.padding = 0;
    normalize();
  }
  function resetCrop() {
    if (media.value)
      composition.crop = { x: 0, y: 0, width: media.value.width, height: media.value.height };
  }
  function preset(ratio: string) {
    const [w, h] = ratio.split(':').map(Number);
    composition.height = Math.round((composition.width * h) / w);
    normalize();
  }
  function background(value: string) {
    if (/^#[\da-f]{6}$/i.test(value)) {
      composition.background = value.toLowerCase();
      hex.value = composition.background;
    } else {
      toast(text('Enter a hex color, e.g. #D7E3D1', 'Wpisz HEX, np. #D7E3D1'));
      hex.value = composition.background;
    }
  }
  function seek(value: number) {
    if (source.value instanceof HTMLVideoElement) {
      source.value.currentTime = clamp(value, 0, media.value!.duration);
      currentTime.value = source.value.currentTime;
    }
  }
  function play() {
    if (!(source.value instanceof HTMLVideoElement)) return;
    if (playing.value) stopPlayback();
    else {
      if (currentTime.value < composition.start || currentTime.value >= composition.end)
        seek(composition.start);
      source.value
        .play()
        .then(() => (playing.value = true))
        .catch(report);
    }
  }
  function cropPointer(event: PointerEvent) {
    if (!media.value) return;
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture(event.pointerId);
    const origin = { ...composition.crop },
      x = event.clientX,
      y = event.clientY,
      handle = (event.target as HTMLElement).dataset.handle || '',
      m = media.value;
    element.onpointermove = (e) => {
      const dx = (e.clientX - x) / zoom.value,
        dy = (e.clientY - y) / zoom.value;
      let left = origin.x,
        top = origin.y,
        right = left + origin.width,
        bottom = top + origin.height;
      if (!handle) {
        left = clamp(origin.x + dx, 0, m.width - origin.width);
        top = clamp(origin.y + dy, 0, m.height - origin.height);
        right = left + origin.width;
        bottom = top + origin.height;
      } else {
        if (handle.includes('w')) left = clamp(origin.x + dx, 0, right - 1);
        if (handle.includes('e')) right = clamp(right + dx, left + 1, m.width);
        if (handle.includes('n')) top = clamp(origin.y + dy, 0, bottom - 1);
        if (handle.includes('s')) bottom = clamp(bottom + dy, top + 1, m.height);
      }
      composition.crop = {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(right - left),
        height: Math.round(bottom - top),
      };
      normalize();
    };
    element.onpointerup = element.onpointercancel = () => {
      element.onpointermove = null;
    };
  }
  function trimPointer(event: PointerEvent, key: 'start' | 'end') {
    if (!isVideo.value) return;
    event.stopPropagation();
    event.preventDefault();
    const element = event.currentTarget as HTMLElement,
      track = element.closest('.timeline-track')!.getBoundingClientRect();
    element.setPointerCapture(event.pointerId);
    element.onpointermove = (e) => {
      const value = clamp((e.clientX - track.left) / track.width, 0, 1) * media.value!.duration;
      composition[key] =
        key === 'start'
          ? Math.min(value, composition.end - 0.01)
          : Math.max(value, composition.start + 0.01);
      normalize();
    };
    element.onpointerup = element.onpointercancel = () => {
      element.onpointermove = null;
      seek(composition.start);
    };
  }
  function timelineSeek(event: MouseEvent) {
    if (!isVideo.value || (event.target as HTMLElement).classList.contains('trim-handle')) return;
    const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
    seek(((event.clientX - r.left) / r.width) * media.value!.duration);
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    dropActive.value = false;
    const file = event.dataTransfer?.files[0];
    if (file && !busy.value) void guard(() => importFile(api.filePath(file)));
  }
  function showSettings() {
    Object.assign(draft, settings);
    settingsError.value = '';
    settingsDialog.value?.showModal();
  }
  function recordShortcut(e: KeyboardEvent) {
    e.preventDefault();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      settingsError.value = text('Include Ctrl or Alt.', 'Dodaj Ctrl lub Alt.');
      return;
    }
    const key = e.code.startsWith('Key')
      ? e.code.slice(3)
      : e.code.startsWith('Digit')
        ? e.code.slice(5)
        : e.code === 'Space'
          ? 'Space'
          : e.key;
    draft.shortcut = [
      e.ctrlKey ? 'CommandOrControl' : null,
      e.altKey ? 'Alt' : null,
      e.shiftKey ? 'Shift' : null,
      e.metaKey ? 'Super' : null,
      key,
    ]
      .filter(Boolean)
      .join('+');
    settingsError.value = '';
  }
  async function chooseFolder() {
    draft.folder = await api.chooseFolder();
    settings.folder = draft.folder;
  }
  async function saveSettings() {
    try {
      Object.assign(
        settings,
        await api.saveSettings({
          shortcut: draft.shortcut,
          language: draft.language,
          captureFps: Number(draft.captureFps),
          cursor: draft.cursor,
        }),
      );
      settingsDialog.value?.close();
    } catch (e) {
      settingsError.value = e instanceof Error ? e.message : String(e);
    }
  }
  function showExport() {
    if (!media.value) return;
    stopPlayback();
    format.value = formats.value[0];
    exportStep.value = 'options';
    exportError.value = '';
    exportDialog.value?.showModal();
  }
  function closeExport() {
    if (!busy.value) exportDialog.value?.close();
  }
  function png(c: HTMLCanvasElement): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) =>
      c.toBlob(
        (blob) =>
          blob
            ? blob.arrayBuffer().then(resolve, reject)
            : reject(new Error('Cannot create render mask.')),
        'image/png',
      ),
    );
  }
  async function render() {
    if (busy.value || !media.value) return;
    busy.value = true;
    progress.value = 0;
    exportError.value = '';
    exportStep.value = 'progress';
    stopPlayback();
    normalize();
    try {
      const g = geometry(),
        bg = document.createElement('canvas'),
        mask = document.createElement('canvas');
      bg.width = composition.width;
      bg.height = composition.height;
      const b = bg.getContext('2d')!;
      b.fillStyle = composition.background;
      b.fillRect(0, 0, bg.width, bg.height);
      mask.width = g.w;
      mask.height = g.h;
      const ctx = mask.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, g.w, g.h);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.roundRect(0, 0, g.w, g.h, g.r);
      ctx.fill();
      exported.value = await api.export({
        mediaId: media.value.id,
        composition: snapshot(),
        format: format.value,
        background: await png(bg),
        mask: await png(mask),
      });
      exportStep.value = 'result';
    } catch (e) {
      exportError.value = e instanceof Error ? e.message : String(e);
      exportStep.value = 'options';
    } finally {
      busy.value = false;
    }
  }
  async function fileAction(action: 'path' | 'copy' | 'reveal') {
    if (exported.value) {
      await api.fileAction(action, exported.value.path);
      if (action !== 'reveal') toast(text('Copied to clipboard', 'Skopiowano do schowka'));
    }
  }
  function keyboard(e: KeyboardEvent) {
    if (
      ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName) ||
      document.querySelector('dialog[open]')
    )
      return;
    if (e.code === 'Space') {
      e.preventDefault();
      play();
    }
    if (isVideo.value && ['KeyI', 'KeyO'].includes(e.code)) {
      composition[e.code === 'KeyI' ? 'start' : 'end'] = currentTime.value;
      normalize();
    }
  }
  watch(
    composition,
    () => {
      draw();
      persist();
    },
    { deep: true },
  );
  watch(cropMode, () => nextTick(draw));
  watch(
    () => settings.language,
    (language) => (document.documentElement.lang = language),
  );
  onMounted(async () => {
    observer = new ResizeObserver(draw);
    if (stage.value) observer.observe(stage.value);
    animation = requestAnimationFrame(animate);
    document.addEventListener('keydown', keyboard);
    disposers.push(
      api.on('media', (m) => {
        void guard(() => loadMedia(m));
      }),
      api.on('error', report),
      api.on('status', (s) => (status.value = s)),
      api.on('export-progress', (p) => (progress.value = p)),
    );
    await guard(async () => {
      Object.assign(settings, await api.settings());
      Object.assign(composition, settings.editor);
      hex.value = composition.background;
      initialized = true;
      if (settings.lastFile) {
        try {
          await importFile(settings.lastFile, true);
        } catch {
          toast(
            text(
              'Last file is unavailable. Import another to continue.',
              'Ostatni plik jest niedostępny. Zaimportuj inny.',
            ),
          );
        }
      }
    });
  });
  onUnmounted(() => {
    clearTimeout(saveTimer);
    clearTimeout(toastTimer);
    cancelAnimationFrame(animation);
    observer?.disconnect();
    disposers.forEach((fn) => fn());
    document.removeEventListener('keydown', keyboard);
    stopPlayback();
  });
  return {
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
    seek,
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
  };
}
