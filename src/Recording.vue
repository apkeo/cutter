<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import Icon from './components/Icon.vue';

const started = Date.now();
const seconds = ref(0);
const language = ref('en');
const stopping = ref(false);
const timer = computed(
  () =>
    `${String(Math.floor(seconds.value / 60)).padStart(2, '0')}:${String(seconds.value % 60).padStart(2, '0')}`,
);
let interval: ReturnType<typeof setInterval>;
async function stop() {
  stopping.value = true;
  await window.cutter.stop();
}
onMounted(async () => {
  interval = setInterval(() => (seconds.value = Math.floor((Date.now() - started) / 1000)), 250);
  language.value = (await window.cutter.settings()).language;
});
onUnmounted(() => clearInterval(interval));
</script>

<template>
  <div class="recording-body">
    <div class="recording-indicator">
      <span class="red-dot" /><span id="timer">{{ timer }}</span
      ><span>{{ language === 'pl' ? 'Nagrywanie' : 'Recording' }}</span>
    </div>
    <button id="stop" :disabled="stopping" @click="stop"><Icon name="stop" />Stop</button>
  </div>
</template>

<style lang="scss">
@use './styles/base';
@use './styles/picker';
</style>
