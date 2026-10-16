// CLI for the EarlyPay treasury agent. Core logic: src/lib/earlypay/agent.ts.
//   ARC_NETWORK=testnet  ARC_AGENT_PRIVATE_KEY  EARLYPAY_VAULT
//   LLM_API_KEYS / LLM_BASE_URL / LLM_MODEL (optional; --scripted or no key = deterministic policy)
//   EARLYPAY_HOLD_YIELD_BPS (simulated reserve rate, default 450)  EARLYPAY_BUFFER_USDC (default 2)
// Usage: pnpm earlypay:agent [--every N] [--scripted]
import { agentFromEnv } from '../../src/lib/earlypay/agent';
import { notifyText } from '../alerts';

const every = Number(process.argv[process.argv.indexOf('--every') + 1]) || 0;
void (async () => {
  const agent = agentFromEnv({ scripted: process.argv.includes('--scripted'), notify: notifyText });
  console.log(`EarlyPay agent ${agent.account.address} · vault ${agent.vault} · ledger ${agent.ledger} · ${agent.llm ? 'LLM' : 'deterministic policy'} · hold yield ${agent.policy.holdYieldBps} bps (${agent.policy.holdYieldSource})`);
  do {
    try { const r = await agent.runOnce(); if (!r.length) console.log('No new offers.'); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }
    if (every) await new Promise(res => setTimeout(res, every * 60_000));
  } while (every);
})();
