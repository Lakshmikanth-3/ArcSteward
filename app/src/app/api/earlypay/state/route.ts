// Read-only EarlyPay state for a vault (and optionally one supplier), straight from Arc events.
import { isAddress, getAddress } from 'viem';
import { LEDGER_FROM_BLOCK } from '@/lib/earlypay/ledger';
import { fetchDecisions, fetchOffers, fetchSettlements, fetchSuppliers } from '@/lib/earlypay/chain';
import { verifyChain } from '@/lib/earlypay/log';
import { json, ledger, pub, NET } from '@/lib/earlypay/server';
import { vaultAbi } from '@/lib/arc/abi';
import type { Hex } from '@/lib/earlypay/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const vaultParam = q.get('vault') ?? process.env.EARLYPAY_VAULT ?? '';
  const supplierParam = q.get('supplier');
  if (!isAddress(vaultParam)) return json({ error: 'vault required' }, { status: 400 });
  const vault = getAddress(vaultParam) as Hex;
  const from = LEDGER_FROM_BLOCK[NET];
  try {
    const [offers, decisions, settlements, suppliers, owner, balance, block] = await Promise.all([
      fetchOffers(pub, ledger, from, vault), fetchDecisions(pub, ledger, from, vault), fetchSettlements(pub, ledger, from, vault), fetchSuppliers(pub, ledger, from),
      pub.readContract({ address: vault, abi: vaultAbi, functionName: 'owner' }).catch(() => undefined),
      pub.readContract({ address: vault, abi: vaultAbi, functionName: 'balance' }).catch(() => undefined),
      pub.getBlock(),
    ]);
    const supplier = supplierParam && isAddress(supplierParam) ? supplierParam.toLowerCase() : undefined;
    const mine = <T extends { offer?: { supplier: string } }>(xs: T[]) => supplier ? xs.filter(x => x.offer?.supplier.toLowerCase() === supplier) : xs;
    const latestPayout = new Map<string, { payout: Hex; block: bigint; tx: Hex }>();
    for (const s of suppliers) latestPayout.set(s.supplier.toLowerCase(), { payout: s.payout, block: s.block, tx: s.tx });
    return json({
      network: NET, ledger, vault, owner, balance, now: Number(block.timestamp), agent: process.env.EARLYPAY_VAULT?.toLowerCase() === vault.toLowerCase() ? process.env.NEXT_PUBLIC_EARLYPAY_AGENT : undefined,
      offers: mine(offers), decisions, settlements,
      suppliers: [...latestPayout].map(([supplier, v]) => ({ supplier, ...v })),
      chain: verifyChain(decisions),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.split('\n')[0] : 'RPC error' }, { status: 502 });
  }
}
