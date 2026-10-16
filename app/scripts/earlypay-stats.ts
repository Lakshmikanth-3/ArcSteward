// EarlyPay traction from chain events only (EarlyPayLedger + vaults on Arc testnet).
// Separates real usage from this repo's automated test runs, prints a summary and
// writes docs/TRACTION.md for the submission form.
// Usage: pnpm earlypay:stats
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, http, type PublicClient } from 'viem';
import { network } from '../src/lib/arc/config';
import { LEDGER, LEDGER_FROM_BLOCK } from '../src/lib/earlypay/ledger';
import { fetchOffers, fetchDecisions, fetchSettlements, fetchSuppliers, type DecisionEntry, type SubmittedOffer } from '../src/lib/earlypay/chain';
import { verifyChain } from '../src/lib/earlypay/log';
import { discountAmount, daysEarly, usdc } from '../src/lib/earlypay/math';
import type { Hex } from '../src/lib/earlypay/types';

if (existsSync('.env.local')) for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#') && !process.env[l.slice(0, i)]) process.env[l.slice(0, i)] = l.slice(i + 1); }

type Stats = { vaults: number; suppliers: number; invoices: number; paidEarly: number; humanApproved: number; paidUnits: bigint; discountUnits: bigint; daysEarlySum: number; holds: number; escalations: number; ownerApproved: number; ownerDeclined: number; attacksBlocked: number; chainsValid: number };
const empty = (): Stats => ({ vaults: 0, suppliers: 0, invoices: 0, paidEarly: 0, humanApproved: 0, paidUnits: 0n, discountUnits: 0n, daysEarlySum: 0, holds: 0, escalations: 0, ownerApproved: 0, ownerDeclined: 0, attacksBlocked: 0, chainsValid: 0 });

async function main() {
  const chain = network('testnet');
  const pub = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0], { timeout: 30000, retryCount: 6, retryDelay: 700 }) }) as PublicClient;
  const ledger = LEDGER.testnet!, from = LEDGER_FROM_BLOCK.testnet;
  // Vaults created by this repo's automated e2e runs (and their throwaway suppliers) are test data.
  const testVaults = new Set<string>();
  for (const f of readdirSync('../contracts/arc/deployments').filter(f => f.startsWith('5042002-earlypay-e2e'))) testVaults.add(String(JSON.parse(readFileSync(`../contracts/arc/deployments/${f}`, 'utf8')).vault).toLowerCase());
  const testOwner = JSON.parse(readFileSync('../contracts/arc/deployments/5042002-earlypay-setup.json', 'utf8')).owner.toLowerCase();
  const demoVault = (process.env.EARLYPAY_VAULT ?? '').toLowerCase();

  const [offers, settlements, suppliers] = await Promise.all([fetchOffers(pub, ledger, from), fetchSettlements(pub, ledger, from), fetchSuppliers(pub, ledger, from)]);
  const vaults = [...new Set(offers.map(o => o.offer.vault.toLowerCase()))];
  const ownerOf = new Map<string, string>();
  for (const v of vaults) ownerOf.set(v, String(await pub.readContract({ address: v as Hex, abi: [{ type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }], functionName: 'owner' })).toLowerCase());
  // Test data: e2e vaults (fresh test-owner vaults other than the demo vault) and this repo's UI test suppliers.
  const isTestVault = (v: string) => testVaults.has(v) || (ownerOf.get(v) === testOwner && v !== demoVault);
  const isTestOffer = (o: SubmittedOffer) => isTestVault(o.offer.vault.toLowerCase()) || /^test supplier/i.test(o.meta.supplierName ?? '');

  const buckets = { real: empty(), test: empty() };
  const decisionsByVault = new Map<string, DecisionEntry[]>();
  for (const v of vaults) {
    const d = await fetchDecisions(pub, ledger, from, v as Hex);
    decisionsByVault.set(v, d);
    const b = isTestVault(v) ? buckets.test : buckets.real;
    b.vaults++; if (verifyChain(d).valid) b.chainsValid++;
  }
  const supplierSet = { real: new Set<string>(), test: new Set<string>() };
  for (const o of offers) {
    const kind = isTestOffer(o) ? 'test' : 'real', b = buckets[kind];
    supplierSet[kind].add(o.offer.supplier.toLowerCase());
    b.invoices++;
    const ds = (decisionsByVault.get(o.offer.vault.toLowerCase()) ?? []).filter(d => d.offerHash.toLowerCase() === o.offerHash.toLowerCase());
    const settled = settlements.find(s => s.invoiceHash.toLowerCase() === o.offer.invoiceHash.toLowerCase());
    for (const d of ds) {
      if (d.decision === 'HOLD') b.holds++;
      if (d.decision === 'ESCALATE') b.escalations++;
      if (d.decision === 'HUMAN_APPROVED') b.ownerApproved++;
      if (d.decision === 'REJECT' && d.note?.source === 'owner') b.ownerDeclined++;
      if (d.decision === 'REJECT' && d.note?.source !== 'owner') b.attacksBlocked++;
    }
    const paidBy = ds.find(d => d.decision === 'PAY_EARLY' || d.decision === 'HUMAN_APPROVED');
    if (settled && paidBy && paidBy.offerHash.toLowerCase() === o.offerHash.toLowerCase()) {
      if (paidBy.decision === 'PAY_EARLY') b.paidEarly++; else b.humanApproved++;
      b.paidUnits += settled.amount;
      b.discountUnits += discountAmount(o.offer.faceAmount, o.offer.discountBps);
      const block = await pub.getBlock({ blockNumber: paidBy.block });
      b.daysEarlySum += daysEarly(Number(o.offer.dueDate), Number(block.timestamp));
    }
  }
  buckets.real.suppliers = supplierSet.real.size; buckets.test.suppliers = supplierSet.test.size;
  const registered = new Set(suppliers.map(s => s.supplier.toLowerCase())).size;

  const row = (label: string, f: (s: Stats) => string) => `| ${label} | ${f(buckets.real)} | ${f(buckets.test)} |`;
  const paid = (s: Stats) => s.paidEarly + s.humanApproved;
  const agree = (s: Stats) => { const n = s.ownerApproved + s.ownerDeclined; return n ? `${s.ownerApproved} approved / ${s.ownerDeclined} declined of ${s.escalations} escalations` : `${s.escalations} escalations, none reviewed yet`; };
  const md = `# EarlyPay traction (Arc testnet)

Generated by \`pnpm earlypay:stats\` on ${new Date().toISOString()} from on-chain events only
(EarlyPayLedger [\`${ledger}\`](${chain.blockExplorers.default.url}/address/${ledger}) and the buyer vaults). Nothing here is self-reported.

"Real usage" excludes this repository's automated end-to-end runs (fresh test vaults) and its UI test suppliers.

| Metric | Real usage | Automated tests |
| --- | --- | --- |
${row('Suppliers who sent invoices', s => String(s.suppliers))}
${row('Buyer vaults', s => String(s.vaults))}
${row('Invoices submitted (signed offers)', s => String(s.invoices))}
${row('Paid early by the agent', s => String(s.paidEarly))}
${row('Paid by the owner after escalation', s => String(s.humanApproved))}
${row('USDC paid early', s => usdc(s.paidUnits))}
${row('Average days early', s => paid(s) ? (s.daysEarlySum / paid(s)).toFixed(1) : '0')}
${row('Discount captured by buyers (USDC)', s => usdc(s.discountUnits))}
${row('Held (discount below hurdle)', s => String(s.holds))}
${row('Attacks / bad invoices blocked (REJECT)', s => String(s.attacksBlocked))}
${row('Escalations and owner review', agree)}
${row('Vaults with a valid decision hash chain', s => `${s.chainsValid} / ${s.vaults}`)}

Supplier identities registered on the ledger (all, including tests): ${registered}.
Hold yield used by the agent: simulated reserve rate (USYC requires Circle allowlisting on Arc testnet).
`;
  writeFileSync('../docs/TRACTION.md', md);
  console.log(md);
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
