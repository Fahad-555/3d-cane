/* Headless screenshots + console capture over CDP.
   Tooling only — not part of the site.

   Usage:
     node _shot.mjs <url> <w> <h> <out> [scrollY] [settleMs] [waitTitlePrefix]

   Set SHOT_EVAL to an expression to run in the page just before the
   shutter; its value is printed. Screenshots can only ever tell you
   that something looks wrong — this is how you find out which number
   is wrong, without a rebuild-and-guess round trip.

   Prints every console message and uncaught exception the page
   produced, then writes the screenshot. Exits non-zero if the page
   threw, so a broken render can't quietly look like a good one. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [url, w, h, out, scrollY, settleMs, waitTitle] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node _shot.mjs <url> <w> <h> <out> [scrollY] [settleMs] [waitTitlePrefix]');
  process.exit(1);
}

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9224;
const VW = Number(w) || 1600;
const VH = Number(h) || 1000;
const SETTLE = Number(settleMs) || 2500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--user-data-dir=' + fs.mkdtempSync('C:/Users/FAHADB~1/AppData/Local/Temp/shot-'),
  `--window-size=${VW},${VH}`,
  'about:blank',
], { stdio: 'ignore' });

let ws;
let nextId = 1;
const pending = new Map();
const logs = [];
const errors = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function connect() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no page target');
}

function fmtArg(a) {
  if (a === undefined || a === null) return String(a);
  if (a.type === 'string') return a.value;
  if ('value' in a) return JSON.stringify(a.value);
  return a.description || a.type;
}

try {
  ws = new WebSocket(await connect());
  await new Promise((r) => (ws.onopen = r));

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || []).map(fmtArg).join(' ');
      logs.push(`[${m.params.type}] ${text}`);
      if (m.params.type === 'error') errors.push(text);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      const text = d.exception?.description || d.text;
      errors.push(text);
      logs.push('[exception] ' + text);
    }
    if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      logs.push(`[log:${e.level}] ${e.text}`);
      if (e.level === 'error') errors.push(e.text);
    }
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: VW, height: VH, deviceScaleFactor: 1, mobile: VW < 760,
  });

  await send('Page.navigate', { url });

  // Wait for the page to say it is ready, then settle so damping and
  // any reveal timelines finish before the shutter.
  if (waitTitle) {
    for (let i = 0; i < 80; i++) {
      const r = await send('Runtime.evaluate', {
        expression: 'document.title', returnByValue: true,
      });
      if (String(r.result.value || '').startsWith(waitTitle)) break;
      await sleep(250);
    }
  }
  await sleep(SETTLE);

  if (scrollY && Number(scrollY) > 0) {
    await send('Runtime.evaluate', {
      expression: `window.scrollTo(0, ${Number(scrollY)})`,
    });
    // Lenis eases the scroll in and the choreography damps toward the
    // new target, so a single wait is not enough to land the shot.
    await sleep(1400);
    await send('Runtime.evaluate', {
      expression: `window.scrollTo(0, ${Number(scrollY)})`,
    });
    await sleep(700);
  }

  // The boot sequence is what publishes __voltic, so waiting on it is
  // a truer readiness signal than any fixed sleep — three.js comes off
  // a CDN and a cold profile can take a while to get through it.
  for (let i = 0; i < 120; i++) {
    const r = await send('Runtime.evaluate', {
      expression: '!!window.__voltic', returnByValue: true,
    });
    if (r.result.value === true) break;
    await sleep(250);
  }

  // Runs before the shutter, not after, so an expression that mutates
  // state — nudging the can's target, say — shows up in the shot. The
  // trailing wait is what lets the scene's damping catch up to it.
  if (process.env.SHOT_EVAL) {
    const r = await send('Runtime.evaluate', {
      expression: process.env.SHOT_EVAL,
      returnByValue: true,
      awaitPromise: true,
    });
    console.log('--- eval ---');
    console.log(typeof r.result.value === 'string'
      ? r.result.value
      : JSON.stringify(r.result.value, null, 2));
    if (r.exceptionDetails) console.log('  !! ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    await sleep(Number(process.env.SHOT_EVAL_SETTLE) || 0);
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));

  const title = await send('Runtime.evaluate', {
    expression: 'document.title', returnByValue: true,
  });
  console.log(`${out}  ${VW}x${VH}  title="${title.result.value}"`);

  if (logs.length) {
    console.log('--- console ---');
    for (const l of logs.slice(0, 40)) console.log('  ' + l);
  }
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
}

if (errors.length) {
  console.log(`\n${errors.length} ERROR(S):`);
  for (const e of errors.slice(0, 10)) console.log('  ' + e);
  process.exit(1);
}
