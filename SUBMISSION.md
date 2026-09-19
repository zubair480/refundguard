# RefundGuard submission form text

Ready to paste into the hackathon submission form. Sections match what the form usually asks for; trim as needed.

---

## Project name

RefundGuard

## One-sentence pitch

A financial stress test for AI agents that hold a wallet: it attacks your support bot with simulated scam customers, measures the dollars a ledger and an independent LLM judge catch, and blocks the release when the bot fails.

## Short description (max 120 words)

RefundGuard is a pre-release gate for AI agents that can move money. It runs 11 seed scam personas plus 3 legitimate customers (the control group) against your support bot over multi-turn conversations, using a separate LLM as the attacker. Every dollar movement is replayed against the refund policy in code, so no LLM decides whether money leaked. A second, independent LLM judge then reads the transcript for what the ledger cannot see: money promised in words, policy misstatements, and personal-data leaks, with every finding required to quote the agent verbatim or be discarded. Attacks that succeed are mutated into new variants automatically, growing the regression suite. The gate exits non-zero in CI when the bot fails.

## Longer description (max 300 words)

Support bots with refund authority ship after a vibe check, not a stress test. RefundGuard treats that gap as the problem: it is a release gate that measures loss in dollars, the way a bank stress test measures capital under a shock scenario.

It works in two verification layers. Layer 1 is the ledger: the bot's tools move money in a simulated store ledger, and after each conversation every movement is replayed against the refund policy in code. This is deterministic; no LLM decides whether money leaked. Layer 2 is an independent LLM judge that reads the transcript with the ledger's findings as ground truth, and catches what a ledger cannot see: money promised in writing, policy misstatements, and personal-data leaks. The judge is checked for self-preference bias (the run warns if judge and bot share a model family), and every judge finding must quote the bot's exact words; a finding whose quote is not found verbatim in the transcript is discarded and counted, so the judge cannot invent violations.

Every attack that lands is mutated by an LLM into new social-engineering variants, so the regression suite grows on its own instead of staying fixed. Three legitimate customers run alongside the attacks as a control group, because a bot that refuses everyone leaks $0 and is still useless. The gate checks that legitimate refunds still go through.

The gate itself is one command: `node src/run.js`. It exits 1 when dollars leaked against policy, dollars were promised without entitlement, personal data leaked, or legitimate customers were refused, so it drops directly into a CI pipeline ahead of any deploy that touches a money-moving agent.

## Results from today's runs (real models, files in `runs/`)

| Bot version | Attacks breached | Left the ledger | Promised in writing | Data leaks | Legit served | Gate |
|---|---|---|---|---|---|---|
| v1: friendly prompt, unguarded tools | 3 of 21 | $310 | $709 | 0 | 3 of 3 | BLOCKED |
| v2: strict prompt, unguarded tools | 1 of 13 | $0 | $0 | 1 | 3 of 3 | BLOCKED |
| v3: strict prompt + policy enforced in code | 0 of 11 | $0 | $0 | 0 | 3 of 3 | PASSED |

The stricter prompt (v2) stopped the money but still told a stranger the email on another customer's order. Only enforcing the policy in code (v3) passed, with every honest customer still served. Small samples, one run per version; the point is the method and the gate.

**Track: Production ready AI Agent**

## Technology stack

- Node.js 24, zero dependencies (no npm packages beyond the Node runtime)
- Server-sent events (SSE) dashboard served from a plain Node HTTP server (`src/server.js`, `public/index.html`), no frontend framework
- Provider-agnostic LLM layer (`src/llm.js`): any OpenAI-compatible chat completions gateway, including the EdgeOne Makers model gateway, or the Claude CLI as a subprocess. Victim, attacker, and judge roles can each use a different provider and model
- A deterministic policy engine and simulated store/ledger (`src/store.js`) as the ground-truth oracle
- JSON run traces written to `runs/*.json`, one file per run, with per-conversation spans

## How this maps to Track 2 focus areas

| Focus area | How RefundGuard addresses it |
|---|---|
| Agent evaluation | Scores the agent on dollars leaked, dollars promised, PII leaks, and legitimate-customer service rate, not a pass/fail vibe check |
| Smoke test and simulation | 11 seed attack personas plus 3 legitimate personas run multi-turn simulated conversations against the agent before release |
| Auditability | Every run writes a full JSON trace (transcripts, tool calls, ledger entries, judge verdicts, discarded findings) to `runs/*.json` |
| Human-in-the-loop | The dashboard (`npm run dashboard`) launches runs, streams every conversation live, and lets a human open any transcript to see the ledger leak and the quoted judge finding side by side. Reading those quotes is how three judge errors were found and fixed today |
| Agent decision monitoring | Flat promises are counted as loss; conditional ones ("once the team verifies...") are tracked separately and surfaced as a note. Saved runs can be re-scored with `node src/rejudge.js` when the judge improves |
| Agent self-evolve | Every attack that breaches the agent is mutated by an LLM into new variants; variants that also succeed join the regression suite automatically |
| Agent risk management | Two independent verification layers (deterministic ledger, quote-verified LLM judge) plus a control group so a bot that just refuses everyone also fails |
| Model portability | The LLM layer is provider-agnostic: swap victim/attacker/judge between any OpenAI-compatible endpoint, the Claude CLI, or a mock provider, independently per role |
| Budget control | Per-role token and cost tracking (`usage` in `src/llm.js`) reported per run, so cost-per-conversation is visible alongside risk |

## Sponsor technologies

Being strictly honest about what is wired versus what is compatible:

- **Tencent EdgeOne**: the LLM layer is compatible with the EdgeOne Makers model gateway today, since it speaks the standard OpenAI-compatible chat completions API (`VICTIM_PROVIDER=openai` with an EdgeOne Makers `BASE_URL`). The report is hosted on EdgeOne Makers: https://refundguard-dpaq1q5aneiq.edgeone.dev (built with `npm run export`, deployed by direct upload). In the recorded runs all three roles ran on Claude models; a Makers gateway model was not used.
- **AgentX**: integration-ready, not wired. Each run already writes one JSON trace file with every conversation's messages, tool calls, ledger entries and judge verdicts, so exporting those as AgentX traces is the next step.
- **VeloDB**: integration-ready, not wired. The same per-run JSON traces are the natural rows for a VeloDB table if we wanted to query across many runs.
- **ServiceNow, TikTok, AWS, Memories.ai**: no integration attempted for this submission.

## Links

- Live report (EdgeOne Makers): https://refundguard-dpaq1q5aneiq.edgeone.dev
- Repo: https://github.com/zubair480/refundguard
- Demo video: [demo video link]
