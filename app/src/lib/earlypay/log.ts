// Hash-chained decision log. decisionHash matches EarlyPayLedger._link exactly, so
// anyone (the audit page in a browser) can recompute and verify the chain.
import { encodeAbiParameters, keccak256, toHex, zeroHash } from 'viem';
import { DECISIONS, type Decision, type Hex } from './types';

/** Canonical JSON (sorted keys, bigint as string) so the same inputs always hash the same. */
export function canonical(value: unknown): string {
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export const inputsHash = (inputs: unknown) => keccak256(toHex(canonical(inputs)));

export function decisionHash(vault: Hex, invoiceHash: Hex, offerHash: Hex, decision: Decision, inputs: Hex, prevHash: Hex, index: bigint) {
  return keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint8' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
    [vault, invoiceHash, offerHash, DECISIONS.indexOf(decision), inputs, prevHash, index]));
}

export type ChainRecord = { vault: Hex; invoiceHash: Hex; offerHash: Hex; decision: Decision; inputsHash: Hex; prevHash: Hex; decisionHash: Hex };

/** Checks every link and recomputes every hash. Returns the first broken index, or -1 if valid. */
export function verifyChain(records: ChainRecord[]) {
  let prev: Hex = zeroHash;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.prevHash !== prev) return { valid: false, brokenAt: i, why: 'prevHash does not point at the previous decision' };
    if (decisionHash(r.vault, r.invoiceHash, r.offerHash, r.decision, r.inputsHash, r.prevHash, BigInt(i)) !== r.decisionHash) return { valid: false, brokenAt: i, why: 'decisionHash does not match its contents' };
    prev = r.decisionHash;
  }
  return { valid: true, brokenAt: -1, why: '' };
}

/** The note stored on-chain with each decision: reason plus the numbers it was based on. */
export type DecisionNote = { reason: string; source: string; overridden?: string; inputs: unknown; payment?: { tx: string; amount: string; by: 'agent' | 'owner' } };
export const encodeNote = (n: DecisionNote) => canonical(n);
export function decodeNote(text: string): DecisionNote | undefined { try { return JSON.parse(text) as DecisionNote; } catch { return undefined; } }
