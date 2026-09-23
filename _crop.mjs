/* Crops + upscales a region of an image through headless Chrome.
   Tooling only — not part of the site.

   Usage: node _crop.mjs <src> <x> <y> <w> <h> <zoom> <out>
   The source is a file path; Chrome draws it to a <canvas> at `zoom`
   and the viewport is clipped to the region. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [src, x, y, w, h, zoom, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: node _crop.mjs <src> <x> <y> <w> <h> <zoom> <out>');
  process.exit(1);
}

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9223;
const VW = Math.round(Number(w) * Number(zoom));
const VH = Math.round(Number(h) * Number(zoom));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const abs = path.resolve(src).replace(/\\/g, '/');

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--user-data-dir=' + fs.mkdtempSync('C:/Users/FAHADB~1/AppData/Local/Temp/crop-'),
  `--window-size=${VW},${VH}`,
  'about:blank',
], { stdio: 'ignore' });

let ws;
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no page target');
}

ws = new WebSocket(await connect());
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: VW, height: VH, deviceScaleFactor: 1, mobile: false,
});

// Chrome refuses file:// images from a data: document, so the page
// itself is a file:// document in the same directory tree.
const html = `<!doctype html><meta charset=utf-8>
<style>html,body{margin:0;padding:0;background:#000;overflow:hidden}
canvas{display:block;image-rendering:auto}</style>
<canvas id=c></canvas>
<script>
const img = new Image();
img.onload = () => {
  const c = document.getElementById('c');
  c.width = ${VW}; c.height = ${VH};
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, ${Number(x)}, ${Number(y)}, ${Number(w)}, ${Number(h)},
              0, 0, ${VW}, ${VH});
  document.title = 'ready';
};
img.onerror = () => { document.title = 'error'; };
img.src = 'file:///${abs}';
</script>`;

const page = path.join(path.dirname(abs), '_crop.html');
fs.writeFileSync(page, html);
await send('Page.navigate', { url: 'file:///' + page.replace(/\\/g, '/') });

for (let i = 0; i < 40; i++) {
  const r = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  if (r.result.value === 'ready') break;
  if (r.result.value === 'error') { console.error('image failed to load'); process.exit(1); }
  await sleep(150);
}
await sleep(400);

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
fs.unlinkSync(page);
console.log(`${out}  ${VW}x${VH}`);

ws.close();
chrome.kill();
process.exit(0);
