/* Throwaway: serves the project, opens the label harness in headless
   Chrome over CDP and screenshots the whole page.

   Usage: node _tmp/shot.mjs [out.png] */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('c:/Users/Fahad Bhutta/Desktop/figma');
const OUT = process.argv[2] || path.join(ROOT, '_tmp/shot.png');
const PORT = 8000 + Math.floor(Math.random() * 900);
const CDP = 9300 + Math.floor(Math.random() * 400);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('nope'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(PORT, r));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${CDP}`, '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + fs.mkdtempSync('C:/Users/FAHADB~1/AppData/Local/Temp/labelshot-'),
  '--window-size=1500,3000', 'about:blank',
], { stdio: 'ignore' });

let ws, nextId = 1;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no page');
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
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 3000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/_tmp/label.html` });

let title = '';
for (let i = 0; i < 120; i++) {
  const r = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  title = r.result.value || '';
  if (title.startsWith('ready') || title.startsWith('error')) break;
  await sleep(250);
}
console.log('title:', title);
if (title.startsWith('error')) { console.error(title); process.exit(1); }
const ms = await send('Runtime.evaluate', { expression: 'window.__ms', returnByValue: true });
console.log('makeLabelTexture x3:', ms.result.value, 'ms');
await sleep(600);

const dims = await send('Runtime.evaluate', {
  expression: 'JSON.stringify({w: document.documentElement.scrollWidth, h: document.body.scrollHeight})',
  returnByValue: true,
});
const { w, h } = JSON.parse(dims.result.value);
await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
await sleep(400);

// Optional: --clip x,y,w,h,scale to zoom into one region.
const clipArg = process.argv[3];
const clip = clipArg
  ? (([x, y, cw, ch, sc]) => ({ x: +x, y: +y, width: +cw, height: +ch, scale: +sc || 1 }))(clipArg.split(','))
  : { x: 0, y: 0, width: w, height: h, scale: 1 };

const shot = await send('Page.captureScreenshot', {
  format: 'png', captureBeyondViewport: true, clip,
});
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log(`${OUT}  ${w}x${h}`);

ws.close(); chrome.kill(); server.close();
process.exit(0);
