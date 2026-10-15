import { NextResponse, type NextRequest } from 'next/server';
import { resources, challenge, verifyPayment, content, requestNetwork } from '@/lib/arc/x402-server';

// Pay-per-request API: answers 402 with a Velo402 invoice, then serves content once the vault payment verifies on Arc.
export async function GET(request: NextRequest, ctx: { params: Promise<{ resource: string }> }) {
  const { resource } = await ctx.params;
  if (!resources[resource]) return NextResponse.json({ error: 'Unknown resource', available: Object.keys(resources) }, { status: 404 });
  const net = requestNetwork(request.nextUrl.searchParams.get('network'));
  const header = request.headers.get('x-payment');
  if (!header) return NextResponse.json(challenge(resource, request.nextUrl.href, net), { status: 402 });
  let proof: { txHash: `0x${string}`; invoice: string };
  try { proof = JSON.parse(atob(header)); } catch { return NextResponse.json({ error: 'Malformed X-PAYMENT header' }, { status: 400 }); }
  if (!/^0x[0-9a-fA-F]{64}$/.test(proof.txHash ?? '') || typeof proof.invoice !== 'string') return NextResponse.json({ error: 'Malformed payment proof' }, { status: 400 });
  const result = await verifyPayment(resource, proof.txHash, proof.invoice, net);
  if (!result.ok) return NextResponse.json({ ...challenge(resource, request.nextUrl.href, net), error: result.reason }, { status: 402 });
  return NextResponse.json({ resource, paidBy: { vault: result.vault, agent: result.agent, amountUnits: String(result.amount), tx: proof.txHash }, network: net, data: await content(resource, net) }, { headers: { 'X-PAYMENT-RESPONSE': btoa(JSON.stringify({ success: true, tx: proof.txHash })) } });
}
