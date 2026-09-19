// Dashboard server. node src/server.js [port]
// Serves the UI, completed runs, and launches stress-test jobs whose progress streams to the browser over SSE.
// Launching a run spends LLM budget, so the server binds to localhost and rejects cross-origin POSTs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, cfg, family } from './llm.js';
import { PERSONAS } from './attacker.js';

const port = Number(process.argv[2] || process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const runsDir = path.join(ROOT, 'runs');
const jobs = new Map(); // jobId -> { events: [], clients: Set, done: bool }
let running = null;

const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };

export function readRuns() {
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir).filter(f => f.endsWith('.json')).sort().flatMap(f => { try { return [JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8'))]; } catch { return []; } })
    // Bot versions side by side (v1, v2, v3), oldest first within a version, so the comparison chart reads left to right.
    .sort((a, b) => String(a.victimVersion).localeCompare(String(b.victimVersion)) || String(a.startedAt).localeCompare(String(b.startedAt)));
}
export function readConfig() {
  const models = Object.fromEntries(['victim', 'attacker', 'judge'].map(r => { const c = cfg(r); return [r, { provider: c.provider, model: c.model, family: family(c.model) }]; }));
  return { models, judgeIndependent: models.victim.family !== models.judge.family,
    personas: PERSONAS.map(p => ({ id: p.id, name: p.name, kind: p.kind, goal: p.goal, entitledUsd: p.entitledUsd })), running: running ? { jobId: running } : null };
}

function publish(job, evt) {
  job.events.push(evt);
  for (const res of job.clients) res.write(`data: ${JSON.stringify(evt)}\n\n`);
}

function startJob(opts) {
  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const job = { events: [], clients: new Set(), done: false };
  jobs.set(jobId, job); running = jobId;
  const clamp = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Math.round(Number(v)) : d));
  const victim = ['v1', 'v2', 'v3'].includes(opts.victim) ? opts.victim : 'v1';
  const label = String(opts.label || '').replace(/[^\w .()-]/g, '').replace(/-{2,}/g, '-').trim().slice(0, 40) || `${victim} run`;
  const args = ['src/run.js', '--victim', victim, '--label', label, '--evolve', clamp(opts.evolve, 0, 2, 1), '--variants', clamp(opts.variants, 1, 3, 2), '--turns', clamp(opts.turns, 2, 5, 3)].map(String);
  const child = spawn(process.execPath, ['--no-deprecation', ...args], { cwd: ROOT, env: { ...process.env, RG_EVENTS: '1' } });
  let buf = '', sawDone = false, errTail = '';
  child.stdout.on('data', d => {
    buf += d; const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) if (line.startsWith('@@EVT ')) { try { const e = JSON.parse(line.slice(6)); if (e.type === 'done') sawDone = true; publish(job, e); } catch { /* ignore a malformed line */ } }
  });
  child.stderr.on('data', d => { errTail = (errTail + d).slice(-600); });
  const finish = msg => { if (job.done) return; if (!sawDone) publish(job, { type: 'error', message: msg }); job.done = true; if (running === jobId) running = null; for (const res of job.clients) res.end(); job.clients.clear(); };
  child.on('error', e => finish(`could not start run: ${e.message}`));
  child.on('close', code => finish(`run exited with code ${code} before finishing. ${errTail.trim()}`));
  return jobId;
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => { let b = ''; req.on('data', d => { b += d; if (b.length > limit) { reject(new Error('body too large')); req.destroy(); } }); req.on('end', () => resolve(b)); req.on('error', reject); });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/api/runs') return send(res, 200, readRuns());
    if (req.method === 'GET' && url.pathname === '/api/config') return send(res, 200, readConfig());
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, running: !!running });
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'cross-origin requests are not allowed' });
      if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'send application/json' });
      if (running) return send(res, 409, { error: 'a run is already in progress', jobId: running });
      let opts; try { opts = JSON.parse(await readBody(req) || '{}'); } catch { return send(res, 400, { error: 'invalid JSON body' }); }
      return send(res, 202, { jobId: startJob(opts || {}) });
    }
    const m = url.pathname.match(/^\/api\/jobs\/([a-z0-9]+)\/events$/);
    if (req.method === 'GET' && m) {
      const job = jobs.get(m[1]);
      if (!job) return send(res, 404, { error: 'unknown job' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      for (const e of job.events) res.write(`data: ${JSON.stringify(e)}\n\n`);
      if (job.done) return res.end();
      job.clients.add(res); req.on('close', () => job.clients.delete(res));
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(res, 200, fs.readFileSync(path.join(ROOT, 'public', 'index.html')), 'text/html; charset=utf-8');
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'src', 'server.js')) {
  setInterval(() => { for (const j of jobs.values()) for (const r of j.clients) r.write(': keep-alive\n\n'); }, 20000).unref();
  server.listen(port, host, () => console.log(`RefundGuard dashboard: http://localhost:${port}`));
}
