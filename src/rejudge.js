// node src/rejudge.js <run-id | all>
// Re-scores saved transcripts with the current judge and scoring rules, without re-running any conversation.
// The ledger evidence is reused as is; only Layer 2 and the totals are recomputed. The previous verdict is kept for audit.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, cfg, family, usage } from './llm.js';
import { PERSONAS } from './attacker.js';
import { judge } from './judge.js';
import { scoreConversation, summarize } from './score.js';

const target = process.argv[2];
if (!target) { console.error('usage: node src/rejudge.js <run-id | all>'); process.exit(2); }
const runsDir = path.join(ROOT, 'runs');
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.json') && (target === 'all' || f.startsWith(target)));
if (!files.length) { console.error(`no run matches "${target}"`); process.exit(2); }
const J = cfg('judge');
const roots = Object.fromEntries(PERSONAS.map(p => [p.id, p]));

for (const f of files) {
  const file = path.join(runsDir, f), run = JSON.parse(fs.readFileSync(file, 'utf8'));
  const before = { leakedUsd: run.totals.leakedUsd, promisedUsd: run.totals.promisedUsd, breached: run.totals.breached };
  let i = 0;
  await Promise.all(Array.from({ length: Number(process.env.CONCURRENCY || 4) }, async () => {
    while (i < run.results.length) {
      const r = run.results[i++];
      if (r.error) continue;
      // Evolved variants ("double_dip~1") inherit entitlement and expectations from their seed persona.
      const persona = { ...roots[r.persona.id.split('~')[0]], ...r.persona };
      const verdict = await judge(J, persona, r.transcript, r.audit);
      const ledger = r.audit.entries.map(e => ({ type: e.type, orderId: e.orderId, amount: e.amount }));
      Object.assign(r, { previousVerdict: r.previousVerdict || r.verdict, verdict }, scoreConversation(persona, ledger, r.audit, verdict));
    }
  }));
  Object.assign(run, summarize(run.results));
  run.models.judge = { provider: J.provider, model: J.model, family: family(J.model) };
  run.judgeIndependent = run.models.victim.family !== run.models.judge.family;
  run.rejudgedAt = new Date().toISOString();
  run.usage = { ...run.usage, rejudge: { ...usage.judge } }; delete usage.judge;
  fs.writeFileSync(file, JSON.stringify(run, null, 2));
  console.log(`${run.label}: leaked $${before.leakedUsd} -> $${run.totals.leakedUsd} | promised $${before.promisedUsd} -> $${run.totals.promisedUsd} (+$${run.totals.conditionalUsd} conditional, not counted) | breached ${before.breached} -> ${run.totals.breached} | gate ${run.gate.pass ? 'PASS' : 'BLOCKED'}`);
}
