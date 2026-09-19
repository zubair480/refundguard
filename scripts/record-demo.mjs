// node scripts/record-demo.mjs   → demo.mp4
// Records the dashboard (Replay of a recorded run, then the report) with headless Chrome + ffmpeg. No npm packages.
// Needs: the dashboard running on http://localhost:4173, Chrome installed, ffmpeg on PATH.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_ = process.env.RG_URL || 'http://localhost:4173', W = 1600, H = 900, PORT = 9333;
const out = path.resolve(process.argv[2] || 'demo.mp4');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
if (!chrome) throw new Error('Chrome not found');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-chrome-')), frames = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-frames-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${PORT}`, `--window-size=${W},${H}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', '--mute-audio', 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page'); } catch { /* not up yet */ } if (!target) await sleep(250); }
if (!target) throw new Error('Chrome debugging port did not come up');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = expression => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).then(r => r?.result?.value);

await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await send('Page.navigate', { url: URL_ });
await sleep(2500);

let on = true, n = 0; const t0 = Date.now();
const loop = (async () => { while (on) { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 84 }); if (r?.data) fs.writeFileSync(path.join(frames, `f${String(++n).padStart(5, '0')}.jpg`), Buffer.from(r.data, 'base64')); await sleep(30); } })();
const say = s => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${s}`);

say('hero'); await sleep(3500);
say('replay v1'); await ev(`document.getElementById('replay').click()`); await sleep(900);
await ev(`document.querySelector('#live').scrollIntoView({block:'start'}); scrollBy(0,-64)`);
for (let i = 0; i < 160; i++) {                       // wait for the verdict, glancing at the chats on the way
  if (await ev(`!!document.querySelector('.verdict')`)) break;
  if (i === 24) await ev(`scrollBy({top:430,behavior:'smooth'})`);
  if (i === 56) await ev(`scrollBy({top:-430,behavior:'smooth'})`);
  await sleep(500);
}
say('verdict'); await sleep(5500);
say('report'); await ev(`document.getElementById('to-report')?.click()`); await sleep(3200);
await ev(`document.querySelector('.kpis')?.scrollIntoView({block:'center',behavior:'smooth'})`); await sleep(3000);
say('evidence'); await ev(`[...document.querySelectorAll('#conv-body tr')].find(t=>/Personal data fishing/.test(t.textContent))?.click()`); await sleep(3500);
await ev(`document.querySelector('.drawer mark')?.scrollIntoView({block:'center',behavior:'smooth'})`); await sleep(4500);
await ev(`closeDrawer()`); await sleep(600);
say('compare'); await ev(`document.querySelector('.chartwrap')?.scrollIntoView({block:'center',behavior:'smooth'})`); await sleep(3500);
say('v2'); await ev(`document.querySelector('.chartwrap .grp[data-run="1"]')?.dispatchEvent(new MouseEvent('click',{bubbles:true})); scrollTo({top:document.querySelector('.gate').offsetTop-90,behavior:'smooth'})`); await sleep(4000);
say('v3'); await ev(`document.querySelector('.chartwrap .grp[data-run="2"]')?.dispatchEvent(new MouseEvent('click',{bubbles:true})); scrollTo({top:document.querySelector('.gate').offsetTop-90,behavior:'smooth'})`); await sleep(4500);

on = false; await loop;
const secs = (Date.now() - t0) / 1000, fps = Math.max(1, n / secs);
say(`${n} frames, ${fps.toFixed(1)} fps`);
try { ws.close(); } catch { /* closing anyway */ } proc.kill();
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', fps.toFixed(3), '-i', path.join(frames, 'f%05d.jpg'), '-vf', 'fps=24,format=yuv420p', '-c:v', 'libx264', '-crf', '24', '-movflags', '+faststart', out], { stdio: 'inherit' });
fs.rmSync(frames, { recursive: true, force: true });
console.log(`wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${secs.toFixed(0)}s)`);
process.exit(0);
