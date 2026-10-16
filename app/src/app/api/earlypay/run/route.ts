// Runs the hosted EarlyPay treasury agent once for the demo vault (Arc testnet).
// Safe to expose: the agent only acts within its deterministic policy and the vault's on-chain limits.
import { json, serverAgent, throttle } from '@/lib/earlypay/server';
import type { RunResult } from '@/lib/earlypay/agent';

export const maxDuration = 60;

export async function POST() {
  const agent = serverAgent();
  if (!agent) return json({ error: 'Hosted agent not configured' }, { status: 503 });
  if (!throttle('run', 8_000)) return json({ error: 'The agent ran a moment ago; try again in a few seconds.' }, { status: 429 });
  const results: RunResult[] = [];
  try { await agent.runOnce(r => results.push(r)); return json({ ok: true, results }); }
  catch (e) { return json({ error: e instanceof Error ? e.message.split('\n')[0] : 'Agent error', results }, { status: 500 }); }
}
