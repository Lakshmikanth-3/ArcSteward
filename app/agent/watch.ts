// Owner-side watcher: polls a vault on Arc and sends every new Paid / GasToppedUp / Revoked event to the alert channels.
// Run: ARC_NETWORK=testnet ARC_VAULT_ADDRESS=0x... ALERT_WEBHOOK_URL=... pnpm arc:watch
import { createPublicClient, http } from 'viem';
import { network, address, displayUsdc } from '../src/lib/arc/config';
import { vaultAbi } from '../src/lib/arc/abi';
import { notify } from './alerts';

const chain = network(process.env.ARC_NETWORK ?? 'testnet');
const vault = address(process.env.ARC_VAULT_ADDRESS ?? '');
const client = createPublicClient({ chain, transport: http(process.env.ARC_RPC_URL ?? chain.rpcUrls.default.http[0]) });
async function main() {
let from = await client.getBlockNumber();
console.log(`Watching ${vault} on ${chain.name} from block ${from}`);
for (;;) {
  try {
    const to = await client.getBlockNumber();
    if (to >= from) {
      for (const log of await client.getContractEvents({ address: vault, abi: vaultAbi, fromBlock: from, toBlock: to })) {
        const a = log.args as Record<string, unknown>;
        if (log.eventName === 'Paid') console.log((await notify({ type: 'paid', vault, agent: a.agent as `0x${string}`, recipient: String(a.recipient), amount: displayUsdc(a.amount as bigint), hash: log.transactionHash })).text);
        if (log.eventName === 'GasToppedUp') console.log((await notify({ type: 'gas', vault, agent: a.agent as `0x${string}`, amount: displayUsdc(a.amount as bigint), hash: log.transactionHash })).text);
        if (log.eventName === 'Revoked') console.log((await notify({ type: 'rejected', vault, agent: a.agent as `0x${string}`, reason: 'Revoked by owner' })).text);
      }
      from = to + 1n;
    }
  } catch (e) { console.error('poll failed, retrying', e instanceof Error ? e.message : e); }
  await new Promise(r => setTimeout(r, 10_000));
}
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
