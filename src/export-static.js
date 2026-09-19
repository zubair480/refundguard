// node src/export-static.js  → dist/index.html
// A self-contained, read-only copy of the dashboard with all runs embedded. Host it anywhere (e.g. EdgeOne Makers).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './llm.js';
import { readRuns, readConfig } from './server.js';

const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const runs = readRuns().filter(r => !r.mock);
// "<" is escaped so adversarial transcript text can never close the script tag.
const data = JSON.stringify({ runs, config: { ...readConfig(), running: null } }).replace(/</g, '\\u003c');
const at = html.lastIndexOf('<script>');
if (at < 0) throw new Error('public/index.html has no inline <script> to anchor on');
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'index.html'), `${html.slice(0, at)}<script>window.__RG_STATIC__=${data}</script>\n${html.slice(at)}`);
console.log(`dist/index.html written with ${runs.length} run(s)`);
