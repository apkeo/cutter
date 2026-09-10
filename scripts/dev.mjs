import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
await import('./build.mjs');
const server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
await server.listen();
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, CUTTER_DEV_URL: 'http://127.0.0.1:5173' },
});
child.on('close', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
