// Server-only helpers for the EarlyPay API routes. Arc TESTNET only: the relayer and
// agent keys are dedicated, disposable testnet signers from the git-ignored .env.local.
import 'server-only';
import { createPublicClient, createWalletClient, http, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { network } from '../arc/config';
import { LEDGER } from './ledger';
import { EarlyPayAgent, policyFromEnv } from './agent';
import { llmFromEnv } from './llm';
import type { Hex } from './types';

export const NET = 'testnet' as const;
export const chain = network(NET);
const transport = http(process.env.ARC_TESTNET_RPC_URL ?? chain.rpcUrls.default.http[0], { timeout: 20000, retryCount: 6, retryDelay: 700 });
export const pub = createPublicClient({ chain, transport }) as PublicClient;
export const ledger = LEDGER[NET]!;

const key = (name: string) => { const k = process.env[name]; return k && /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : undefined; };

export function relayer() {
  const k = key('EARLYPAY_RELAYER_PRIVATE_KEY');
  if (!k) throw new Error('Relayer not configured (EARLYPAY_RELAYER_PRIVATE_KEY)');
  return createWalletClient({ account: privateKeyToAccount(k), chain, transport });
}

export function serverAgent(vault?: string) {
  const k = key('EARLYPAY_AGENT_PRIVATE_KEY');
  const v = (vault ?? process.env.EARLYPAY_VAULT) as Hex | undefined;
  if (!k || !v) return undefined;
  if (v.toLowerCase() !== process.env.EARLYPAY_VAULT?.toLowerCase()) return undefined; // the hosted agent serves one demo vault
  return new EarlyPayAgent(privateKeyToAccount(k), v, NET, policyFromEnv(), llmFromEnv(), process.env.ARC_TESTNET_RPC_URL);
}

/** JSON with bigint as string. */
export const json = (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data, (_, v) => typeof v === 'bigint' ? v.toString() : v), { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });

/** Tiny per-key throttle for public endpoints (per server instance). */
const last = new Map<string, number>();
export function throttle(key: string, ms: number) { const t = Date.now(), prev = last.get(key) ?? 0; if (t - prev < ms) return false; last.set(key, t); return true; }
