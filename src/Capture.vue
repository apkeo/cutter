<script setup lang="ts">
import { onUnmounted } from 'vue';

// A sandboxed, hidden capture worker. Chunks are acknowledged by the main process
// before the next chunk is written, so recording does not buffer the whole video.
const api = window.cutter;
let stream: MediaStream | undefined;
let recorder: MediaRecorder | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let writes = Promise.resolve();
let writeError: unknown;
let stopRequested = false;
let finished = false;
const off = api.on('capture-stop', () => {
  stopRequested = true;
  if (recorder?.state === 'recording') recorder.stop();
});
function cleanup() {
  clearInterval(timer);
  stream?.getTracks().forEach((track) => track.stop());
}
async function finish(error?: string) {
  if (finished) return;
  finished = true;
  cleanup();
  await api.captureFinish(error).catch(() => {});
}
async function start() {
  try {
    const job = await api.captureSession();
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: job.fps },
      audio: false,
    });
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth)
      await new Promise<void>((resolve) =>
        video.addEventListener('loadeddata', () => resolve(), { once: true }),
      );
    const sx = video.videoWidth / job.display.width,
      sy = video.videoHeight / job.display.height;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(job.rect.width * sx));
    canvas.height = Math.max(2, Math.round(job.rect.height * sy));
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const draw = () =>
      ctx.drawImage(
        video,
        job.rect.x * sx,
        job.rect.y * sy,
        job.rect.width * sx,
        job.rect.height * sy,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    draw();
    if (job.mode === 'screenshot') {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Screenshot could not be encoded.'))),
          'image/png',
        ),
      );
      await api.captureChunk(await blob.arrayBuffer());
      await finish();
      return;
    }
    timer = setInterval(draw, 1000 / job.fps);
    const canvasStream = canvas.captureStream(job.fps);
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mimeType) throw new Error('A supported recording codec is unavailable.');
    recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 12_000_000 });
    recorder.ondataavailable = (event) => {
      writes = writes
        .then(async () => {
          if (writeError) return;
          for (let offset = 0; offset < event.data.size; offset += 1024 * 1024) {
            await api.captureChunk(
              await event.data.slice(offset, offset + 1024 * 1024).arrayBuffer(),
            );
          }
        })
        .catch((error) => {
          writeError = error;
          if (recorder?.state === 'recording') recorder.stop();
        });
    };
    recorder.onstop = async () => {
      await writes;
      canvasStream.getTracks().forEach((track) => track.stop());
      await finish(writeError ? String(writeError) : undefined);
    };
    recorder.onerror = () => {
      void finish('The screen recording stream failed.');
    };
    stream.getVideoTracks()[0].onended = () => {
      if (recorder?.state === 'recording') recorder.stop();
    };
    recorder.start(1000);
    await api.captureReady();
    if (stopRequested) recorder.stop();
  } catch (error) {
    await finish(error instanceof Error ? error.message : String(error));
  }
}
onUnmounted(() => {
  off();
  cleanup();
});
</script>

<template><button id="begin-capture" aria-hidden="true" @click="start" /></template>

<style lang="scss" scoped>
button {
  display: none;
}
</style>
