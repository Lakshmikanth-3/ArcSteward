// Gasless relay for suppliers: verifies and submits a supplier-signed registration or
// offer to EarlyPayLedger on Arc testnet, paying gas from a dedicated testnet relayer.
// The contract checks every signature; the relayer cannot alter what the supplier signed.
import { after } from 'next/server';
import { getAddress, isAddress, isHex } from 'viem';
import { ledgerAbi } from '@/lib/arc/abi';
import { json, ledger, pub, relayer, serverAgent, throttle } from '@/lib/earlypay/server';
import type { Hex, Offer } from '@/lib/earlypay/types';

export const maxDuration = 60;

type Body =
  | { kind: 'register'; supplier: string; payout: string; profileHash: string; signature: string }
  | { kind: 'offer'; offer: Record<string, string | number>; signature: string; meta: string };

const hex32 = (v: unknown) => typeof v === 'string' && isHex(v) && v.length === 66;

export async function POST(req: Request) {
  let body: Body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, { status: 400 }); }
  try {
    const wallet = relayer();
    if (body.kind === 'register') {
      if (!isAddress(body.supplier) || !isAddress(body.payout) || !hex32(body.profileHash) || !isHex(body.signature)) return json({ error: 'Invalid registration' }, { status: 400 });
      if (!throttle(`reg:${body.supplier.toLowerCase()}`, 10_000)) return json({ error: 'Slow down' }, { status: 429 });
      const { request } = await pub.simulateContract({ account: wallet.account, address: ledger, abi: ledgerAbi, functionName: 'registerSupplierBySig', args: [getAddress(body.supplier), getAddress(body.payout), body.profileHash as Hex, body.signature as Hex] });
      const tx = await wallet.writeContract(request);
      const r = await pub.waitForTransactionReceipt({ hash: tx, timeout: 60_000 });
      return json({ ok: r.status === 'success', tx });
    }
    if (body.kind === 'offer') {
      const o = body.offer;
      if (![o.vault, o.supplier, o.payout].every(a => typeof a === 'string' && isAddress(a)) || !hex32(o.invoiceHash) || !isHex(body.signature)) return json({ error: 'Invalid offer' }, { status: 400 });
      if (typeof body.meta !== 'string' || body.meta.length > 4000) return json({ error: 'Invoice details too long' }, { status: 400 });
      if (!throttle(`offer:${String(o.supplier).toLowerCase()}`, 5_000)) return json({ error: 'Slow down' }, { status: 429 });
      const offer: Offer = { vault: getAddress(o.vault as string), supplier: getAddress(o.supplier as string), invoiceHash: o.invoiceHash as Hex, faceAmount: BigInt(o.faceAmount), discountBps: Number(o.discountBps), payout: getAddress(o.payout as string), dueDate: BigInt(o.dueDate), expiry: BigInt(o.expiry) };
      const { request } = await pub.simulateContract({ account: wallet.account, address: ledger, abi: ledgerAbi, functionName: 'submitOffer', args: [offer, body.signature as Hex, body.meta] });
      const tx = await wallet.writeContract(request);
      const r = await pub.waitForTransactionReceipt({ hash: tx, timeout: 60_000 });
      // If this vault is served by the hosted agent, let it decide right after the response.
      const agent = serverAgent(offer.vault);
      if (agent && process.env.EARLYPAY_AUTORUN !== '0') after(async () => { try { await agent.runOnce(() => {}); } catch { /* the next run will retry */ } });
      return json({ ok: r.status === 'success', tx, agentQueued: !!agent });
    }
    return json({ error: 'Unknown kind' }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const reason = msg.match(/reverted.*?:\s*(\w+)\(\)/)?.[1] ?? msg.match(/Error: (\w+)\(\)/)?.[1];
    return json({ error: reason ?? msg.split('\n')[0].slice(0, 200) }, { status: 400 });
  }
}
