// Owner helper (Arc testnet): approve on the vault every supplier that sent an invoice to it,
// at its own registered payout address only (the second key of the two-key rule). Lists first;
// approves only with --yes. Usage: pnpm earlypay:approve [--yes]
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { network } from '../src/lib/arc/config';
import { ledgerAbi, vaultAbi } from '../src/lib/arc/abi';
import { LEDGER, LEDGER_FROM_BLOCK } from '../src/lib/earlypay/ledger';
import { fetchOffers } from '../src/lib/earlypay/chain';

const local = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

async function main() {
  const chain = network('testnet');
  const transport = http(chain.rpcUrls.default.http[0], { retryCount: 6, retryDelay: 700 });
  const pub = createPublicClient({ chain, transport }) as PublicClient;
  const owner = privateKeyToAccount(process.env.ARC_OWNER_PRIVATE_KEY as Hex);
  const vault = local.EARLYPAY_VAULT as Hex, agent = privateKeyToAccount(local.EARLYPAY_AGENT_PRIVATE_KEY as Hex).address;
  const ledger = LEDGER.testnet!;
  const offers = await fetchOffers(pub, ledger, LEDGER_FROM_BLOCK.testnet, vault);
  const seen = new Map<string, string>();
  for (const o of offers) seen.set(o.offer.supplier.toLowerCase(), o.meta.supplierName ?? '');
  const w = createWalletClient({ account: owner, chain, transport });
  let approved = 0;
  for (const [supplier, name] of seen) {
    const [payout, , , registered] = await pub.readContract({ address: ledger, abi: ledgerAbi, functionName: 'suppliers', args: [supplier as Hex] }) as readonly [Hex, Hex, bigint, boolean];
    if (!registered) { console.log(`skip ${name || supplier}: not registered`); continue; }
    if (/^(test supplier|e2e-)/i.test(name)) { console.log(`skip ${name}: internal test supplier`); continue; }
    if (await pub.readContract({ address: vault, abi: vaultAbi, functionName: 'allowed', args: [agent, payout] })) { console.log(`ok   ${name || supplier}: ${payout} already approved`); continue; }
    if (!process.argv.includes('--yes')) { console.log(`TODO ${name || supplier}: would approve registered payout ${payout}`); continue; }
    const hash = await w.writeContract({ address: vault, abi: vaultAbi, functionName: 'setRecipient', args: [agent, payout, true] });
    await pub.waitForTransactionReceipt({ hash });
    approved++;
    console.log(`✓    ${name || supplier}: approved ${payout} · ${chain.blockExplorers.default.url}/tx/${hash}`);
  }
  if (!process.argv.includes('--yes')) { console.log('\nDry run. Re-run with --yes to approve the TODO suppliers.'); return; }
  if (approved) {
    const res = await fetch('https://arcsteward.vercel.app/api/earlypay/run', { method: 'POST' }).then(r => r.json()).catch(() => undefined) as { results?: { invoice?: string; decision: string }[] } | undefined;
    console.log('agent:', res?.results?.map(r => `${r.invoice} → ${r.decision}`).join(', ') || 'no change');
  }
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
