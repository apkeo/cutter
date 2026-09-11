import { createApp } from 'vue';
import TrayMenu from './Tray.vue';
import Editor from './Editor.vue';
import Picker from './Picker.vue';
import Recording from './Recording.vue';
import Capture from './Capture.vue';

const page = new URLSearchParams(location.search).get('page');
createApp(
  page === 'tray'
    ? TrayMenu
    : page === 'picker'
      ? Picker
      : page === 'recording'
        ? Recording
        : page === 'capture'
          ? Capture
          : Editor,
).mount('#app');
