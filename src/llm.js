// Provider-agnostic chat. Each role (victim, attacker, judge) can use a different provider and model.
// Providers: "openai" (any OpenAI-compatible endpoint, e.g. the EdgeOne Makers gateway), "claude-cli", "mock".
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function cfg(role, overrides = {}) {
  const R = role.toUpperCase();
  const get = k => overrides[k] ?? process.env[`${R}_${k}`] ?? process.env[`LLM_${k}`];
  const provider = get('PROVIDER') || 'mock';
  return { role, provider, baseUrl: get('BASE_URL'), apiKey: get('API_KEY'), model: provider === 'mock' ? 'mock' : get('MODEL') };
}

export function family(model = '') {
  const m = model.toLowerCase();
  if (m === 'mock') return 'mock';
  if (/claude|haiku|sonnet|opus|fable/.test(m)) return 'anthropic';
  if (/gpt|^o\d/.test(m)) return 'openai';
  if (/deepseek/.test(m)) return 'deepseek';
  if (/kimi|moonshot/.test(m)) return 'moonshot';
  if (/hy3|hunyuan/.test(m)) return 'tencent';
  if (/minimax/.test(m)) return 'minimax';
  if (/gemini/.test(m)) return 'google';
  if (/qwen/.test(m)) return 'qwen';
  if (/llama/.test(m)) return 'meta';
  return m.split(/[\/:-]/)[0] || 'unknown';
}

export const usage = {};
function track(role, inTok, outTok, costUsd) {
  const u = (usage[role] ??= { calls: 0, inTok: 0, outTok: 0, costUsd: 0, costKnown: true });
  u.calls++; u.inTok += inTok; u.outTok += outTok;
  if (costUsd == null) u.costKnown = false; else u.costUsd += costUsd;
}
const estTok = s => Math.ceil((s || '').length / 4);

export async function chat(c, system, messages) {
  if (c.provider === 'openai') return openai(c, system, messages);
  if (c.provider === 'claude-cli') return claudeCli(c, system, messages);
  throw new Error(`chat() called for provider "${c.provider}" (role ${c.role})`);
}

async function openai(c, system, messages) {
  if (!c.baseUrl || !c.apiKey || !c.model) throw new Error(`${c.role}: set ${c.role.toUpperCase()}_BASE_URL, _API_KEY and _MODEL in .env`);
  const body = JSON.stringify({ model: c.model, temperature: 0.7, messages: [{ role: 'system', content: system }, ...messages] });
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${c.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', body, headers: { 'content-type': 'application/json', authorization: `Bearer ${c.apiKey}` },
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`), { fatal: true });
      const text = data.choices?.[0]?.message?.content ?? '';
      track(c.role, data.usage?.prompt_tokens ?? estTok(system + JSON.stringify(messages)), data.usage?.completion_tokens ?? estTok(text), null);
      return text;
    } catch (e) {
      lastErr = e;
      if (e.fatal) break;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function claudeCli(c, system, messages) {
  const sysFile = path.join(os.tmpdir(), `rg-sys-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(sysFile, system);
  const prompt = messages.map(m => `${m.role === 'assistant' ? 'YOU' : 'THEM'}: ${m.content}`).join('\n\n') + '\n\nWrite YOUR next message only.';
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--output-format', 'json', '--model', c.model || 'haiku', '--system-prompt-file', `"${sysFile}"`, '--disallowed-tools', '"*"'], { shell: true, cwd: os.tmpdir() });
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('close', () => {
      fs.rmSync(sysFile, { force: true });
      try {
        const j = JSON.parse(out);
        if (j.is_error) return reject(new Error(`claude-cli: ${j.result}`));
        track(c.role, j.usage?.input_tokens ?? estTok(system + prompt), j.usage?.output_tokens ?? estTok(j.result), j.total_cost_usd ?? null);
        resolve(j.result || '');
      } catch { reject(new Error(`claude-cli failed: ${(err || out).slice(0, 300)}`)); }
    });
    p.stdin.end(prompt);
  });
}

// Models wrap JSON in prose or code fences. Pull out the first balanced object or array.
export function parseJson(text) {
  const s = String(text);
  const start = s.search(/[\[{]/);
  if (start < 0) return null;
  const open = s[start], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}
