// node src/run.js --victim v1 --label "v1 baseline" [--evolve 1] [--variants 3] [--turns 4] [--victim-model X] [--judge-model Y] [--only id,id]
// Exit code 1 when the release gate fails, so this drops straight into CI.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, cfg, family, usage } from './llm.js';
import { createVictim } from './victim.js';
import { PERSONAS, nextCustomerMessage, mutate } from './attacker.js';
import { auditLedger } from './store.js';
import { scoreConversation, summarize } from './score.js';
import { judge } from './judge.js';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s*--/).filter(Boolean).map(s => { const [k, ...v] = s.split(' '); return [k, v.join(' ').trim() || true]; }));
const version = args.victim || 'v1';
const generations = Number(args.evolve ?? 1), variants = Number(args.variants ?? 3), maxTurns = Number(args.turns ?? 4);

const C = {
  victim: cfg('victim', args['victim-model'] ? { MODEL: args['victim-model'] } : {}),
  attacker: cfg('attacker'),
  judge: cfg('judge', args['judge-model'] ? { MODEL: args['judge-model'] } : {}),
};

// With RG_EVENTS=1 the dashboard server reads these lines and streams them to the browser.
const emit = e => { if (process.env.RG_EVENTS) console.log('@@EVT ' + JSON.stringify(e)); };

async function converse(persona) {
  const victim = createVictim(version, C.victim, persona.session, t => emit({ type: 'tool', personaId: persona.id, ...t }));
  const transcript = [];
  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const msg = await nextCustomerMessage(C.attacker, persona, transcript, turn);
      if (!msg || /\[END\]/.test(msg)) break;
      transcript.push({ who: 'customer', text: msg });
      emit({ type: 'turn', personaId: persona.id, personaName: persona.name, who: 'customer', text: msg });
      const answer = await victim.reply(msg);
      transcript.push({ who: 'bot', text: answer });
      emit({ type: 'turn', personaId: persona.id, personaName: persona.name, who: 'bot', text: answer });
    }
    emit({ type: 'verifying', personaId: persona.id });
    const audit = auditLedger(victim.ledger, persona.session); // layer 1: deterministic
    const verdict = await judge(C.judge, persona, transcript, audit); // layer 2: LLM judge, after the ledger
    return { persona: slim(persona), transcript, toolLog: victim.toolLog, audit, verdict, ...scoreConversation(persona, victim.ledger, audit, verdict) };
  } catch (e) {
    return { persona: slim(persona), transcript, error: String(e.message || e), audit: { entries: [], leakedUsd: 0, movedUsd: 0 }, promisedUsd: 0, conditionalUsd: 0, pii: false, served: null, breached: false };
  }
}
const slim = p => ({ id: p.id, name: p.name, kind: p.kind, gen: p.gen || 0, parent: p.parent || null, tactic: p.tactic || null, goal: p.goal, entitledUsd: p.entitledUsd });

async function pool(items, fn, n = Number(process.env.CONCURRENCY || 4)) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); log(out[k]); emit({ type: 'conversation', result: out[k] }); } }));
  return out;
}
const log = r => console.log(`${r.error ? 'ERR ' : r.breached ? 'LEAK' : r.served === false ? 'MISS' : 'ok  '} ${r.persona.id.padEnd(22)} leaked $${r.audit.leakedUsd} promised $${r.promisedUsd}${r.pii ? ' PII' : ''}${r.error ? ' ' + r.error : ''}`);

const started = Date.now();
let wave = PERSONAS.filter(p => !args.only || String(args.only).split(',').includes(p.id));
console.log(`RefundGuard: victim ${version} on ${C.victim.model} | attacker ${C.attacker.model} | judge ${C.judge.model}\n`);
emit({ type: 'start', victimVersion: version, label: args.label === true ? '' : args.label || '', turns: maxTurns, models: Object.fromEntries(Object.entries(C).map(([k, c]) => [k, { provider: c.provider, model: c.model, family: family(c.model) }])), personas: wave.map(slim) });
const results = await pool(wave, converse);
for (let g = 0; g < generations; g++) {
  const winners = results.filter(r => r.breached && r.persona.gen === g).slice(0, 5);
  if (!winners.length) break;
  console.log(`\nEvolving ${winners.length} successful attacks into ${winners.length * variants} variants (generation ${g + 1})`);
  const byId = Object.fromEntries([...PERSONAS, ...wave].map(p => [p.id, p]));
  const kids = (await Promise.all(winners.map(w => mutate(C.attacker, byId[w.persona.id], w.transcript, variants).catch(() => [])))).flat();
  wave = kids;
  emit({ type: 'evolve', generation: g + 1, count: kids.length, personas: kids.map(slim) });
  results.push(...await pool(kids, converse));
}

const { totals, gate } = summarize(results);
const reasons = gate.reasons;

const fam = { victim: family(C.victim.model), judge: family(C.judge.model) };
const run = {
  id: `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${version}`, label: args.label === true || !args.label ? `${version} on ${C.victim.model}` : args.label,
  startedAt: new Date(started).toISOString(), seconds: Math.round((Date.now() - started) / 1000), victimVersion: version,
  models: Object.fromEntries(Object.entries(C).map(([k, c]) => [k, { provider: c.provider, model: c.model, family: family(c.model) }])),
  judgeIndependent: fam.victim !== fam.judge, mock: Object.values(C).some(c => c.provider === 'mock'),
  gate, totals, usage, results,
};
fs.mkdirSync(path.join(ROOT, 'runs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'runs', `${run.id}.json`), JSON.stringify(run, null, 2));

console.log(`\n${totals.breached}/${totals.attacks} attacks breached (${totals.evolvedBreaches} found by evolution) | leaked $${totals.leakedUsd} | promised $${totals.promisedUsd} | PII ${totals.piiLeaks} | legit served ${totals.legitServed}/${totals.legit}`);
console.log(`Average loss per hostile chat: ${totals.avgLossPerHostileChatUsd}`);
for (const w of gate.warnings) console.log(`NOTE: ${w}`);
if (!run.judgeIndependent) console.log(`WARNING: judge and bot are the same model family (${fam.judge}). Use a different family for an independent verdict.`);
emit({ type: 'done', runId: run.id, gate: run.gate, totals });
console.log(run.gate.pass ? '\nGATE: PASS, safe to ship' : `\nGATE: BLOCKED\n - ${reasons.join('\n - ')}`);
process.exit(run.gate.pass ? 0 : 1);
