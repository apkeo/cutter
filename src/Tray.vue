<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import Icon from './components/Icon.vue';
import type { Settings, CutterAPI } from '../shared/types';
const settings = ref<Settings>();
const status = ref('');
const busy = ref(false);
let unsubscribe: (() => void) | undefined;
const text = (en: string, pl: string) => (settings.value?.language === 'pl' ? pl : en);
async function refresh() {
  settings.value = await window.cutter.settings();
  status.value = '';
}
async function action(name: Parameters<CutterAPI['trayAction']>[0]) {
  busy.value = true;
  try {
    await window.cutter.trayAction(name);
    if (name === 'copy')
      status.value = text('File copied. Ready to paste.', 'Plik skopiowany. Możesz go wkleić.');
  } catch (e) {
    status.value = String(e).replace(/^Error:.*?: /, '');
  } finally {
    busy.value = false;
  }
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') void action('dismiss');
}
onMounted(() => {
  unsubscribe = window.cutter.on('tray-refresh', refresh);
  void refresh();
  window.addEventListener('focus', refresh);
  window.addEventListener('keydown', key);
});
onUnmounted(() => {
  unsubscribe?.();
  window.removeEventListener('focus', refresh);
  window.removeEventListener('keydown', key);
});
</script>

<template>
  <main class="quick-menu">
    <header>
      <span class="mark">c</span>
      <div>
        <strong>cutter</strong
        ><small>{{ text('Ready when you are', 'Gotowy, gdy Ty jesteś') }}</small>
      </div>
      <span class="ready" />
    </header>
    <button id="tray-capture" class="capture-action" :disabled="busy" @click="action('capture')">
      <Icon name="scan" />
      <div>
        <strong>{{ text('Capture a region', 'Przechwyć fragment') }}</strong
        ><small>{{ text('Screenshot or recording', 'Zdjęcie lub nagranie') }}</small>
      </div>
      <span>↗</span>
    </button>
    <p class="section-label">{{ text('QUICK ACTIONS', 'SZYBKIE AKCJE') }}</p>
    <button id="tray-open" @click="action('open')">
      <Icon name="layers" /><span>{{ text('Open studio', 'Otwórz studio') }}</span>
    </button>
    <button
      id="tray-copy"
      :disabled="busy || !(settings?.lastSavedFile || settings?.lastFile)"
      @click="action('copy')"
    >
      <Icon name="copy" /><span>{{ text('Copy latest file', 'Kopiuj ostatni plik') }}</span>
    </button>
    <button id="tray-folder" @click="action('folder')">
      <Icon name="folder" /><span>{{ text('Open captures folder', 'Otwórz folder zapisów') }}</span>
    </button>
    <p class="feedback" aria-live="polite">
      {{ status || text('Private by design. Always local.', 'Prywatnie. Zawsze lokalnie.') }}
    </p>
    <footer>
      <span>APKEO / CUTTER</span
      ><button id="tray-quit" @click="action('quit')">
        {{ text('Quit Cutter', 'Zamknij Cutter') }} <Icon name="close" />
      </button>
    </footer>
  </main>
</template>

<style lang="scss">
@use './styles/base';
body {
  background: transparent;
}
.quick-menu {
  height: 100vh;
  box-sizing: border-box;
  padding: 20px;
  background: #171d16;
  border: 1px solid #394333;
  border-radius: 16px;
  color: #edf1e9;
  font-family: Inter, sans-serif;
  header {
    display: flex;
    align-items: center;
    gap: 11px;
    margin-bottom: 20px;
    strong {
      font-size: 22px;
      letter-spacing: -1px;
    }
    small {
      display: block;
      color: #a1ae97;
      font-size: 10px;
      margin-top: 3px;
    }
  }
  .mark {
    background: #d4f49a;
    color: #1c2914;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    font-size: 38px;
    font-weight: 700;
    line-height: 1;
    padding-bottom: 5px;
  }
  .ready {
    margin-left: auto;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #c9ed8f;
    box-shadow: 0 0 12px #c9ed8f55;
  }
  button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 10px;
    border-radius: 8px;
    color: inherit;
    text-align: left;
    cursor: pointer;
    background: transparent;
    border: 0;
    font: inherit;
    font-size: 12px;
    &:hover {
      background: #2b3525;
    }
    &:focus-visible {
      outline: 2px solid #d4f49a;
    }
    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  }
  .capture-action {
    background: #d4f49a;
    color: #202c17;
    padding: 15px 12px;
    &:hover {
      background: #e1ffae;
    }
    strong,
    small {
      display: block;
    }
    small {
      margin-top: 5px;
      font-size: 10px;
      opacity: 0.7;
    }
    > span {
      margin-left: auto;
      font-size: 22px;
    }
  }
  .section-label {
    font-size: 9px;
    letter-spacing: 1.7px;
    color: #87967c;
    margin: 20px 10px 5px;
  }
  .feedback {
    min-height: 24px;
    margin: 12px 10px 5px;
    font-size: 10px;
    color: #aebba3;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid #34402c;
    padding-top: 9px;
    > span {
      font-size: 8px;
      letter-spacing: 1.4px;
      color: #8b9b7f;
    }
    button {
      width: auto;
      font-size: 10px;
      gap: 6px;
      padding: 8px 0 8px 8px;
    }
    svg {
      width: 12px;
      height: 12px;
    }
  }
}
</style>
