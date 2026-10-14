import type { Hex } from 'viem';
import { ArcAgent, invoiceId } from './agent';
import { displayUsdc } from './config';

/** HTTP 402 challenge served by a Velo402-enabled API ("velo402-vault" scheme, x402-style). */
export type PaymentRequirement = { scheme: 'velo402-vault'; network: 'arc' | 'arc-testnet'; payTo: string; maxAmountRequired: string; asset: string; resource: string; description: string; invoice: string };
export type Challenge = { x402Version: 1; error?: string; accepts: PaymentRequirement[] };
export const PAYMENT_HEADER = 'X-PAYMENT';
const b64 = (s: string) => typeof btoa === 'function' ? btoa(s) : Buffer.from(s).toString('base64');
const unb64 = (s: string) => typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('utf8');
export const encodePayment = (p: { txHash: Hex; invoice: string }) => b64(JSON.stringify(p));
export const decodePayment = (h: string) => JSON.parse(unb64(h)) as { txHash: Hex; invoice: string };

/**
 * fetch() for agents: on HTTP 402 it pays through the vault (policy enforced on-chain) and retries once with proof.
 * `approve` lets the caller (or an LLM tool policy) veto a price before paying.
 */
export async function fetchWithPayment(agent: ArcAgent, url: string, init: RequestInit = {}, approve: (r: PaymentRequirement) => boolean | Promise<boolean> = () => true) {
  const first = await fetch(url, init);
  if (first.status !== 402) return { response: first, paid: null, requirement: null };
  const challenge = await first.json() as Challenge;
  const req = challenge.accepts.find(a => a.scheme === 'velo402-vault');
  if (!req) throw new Error('No supported payment scheme offered');
  if (!await approve(req)) throw new Error(`Payment of ${displayUsdc(BigInt(req.maxAmountRequired))} USDC declined by caller`);
  await agent.ensureGas().catch(() => null);
  const paid = await agent.pay(req.payTo, displayUsdc(BigInt(req.maxAmountRequired)), invoiceId(req.invoice));
  const headers = { ...(init.headers as Record<string, string> | undefined), [PAYMENT_HEADER]: encodePayment({ txHash: paid.hash, invoice: req.invoice }) };
  const response = await fetch(url, { ...init, headers });
  return { response, paid, requirement: req };
}
