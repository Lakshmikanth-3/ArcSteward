// Risk checks for one offer. Pure function of the offer, its untrusted metadata and on-chain facts.
import type { ChainFacts, EarlyPayPolicy, Offer, OfferMeta, RiskFlag } from './types';

/** Instruction-like text in invoice fields: treated as data and flagged, never obeyed. */
const INJECTION = /(ignore|disregard|override|forget)\b.{0,40}\b(rule|instruction|polic|limit|previous)|\bpay\b.{0,30}\b0x[0-9a-f]{6,}|\b(system prompt|you are now|new instructions?)\b|\bsend\b.{0,20}\b(usdc|funds|money)\b/i;

export function findInjection(meta: OfferMeta) {
  const text = [meta.description, meta.notes, meta.number, meta.supplierName].filter(Boolean).join(' \n ');
  const m = text.match(INJECTION);
  return m ? m[0].slice(0, 80) : undefined;
}

const median = (xs: bigint[]) => { const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); return s.length ? s[Math.floor(s.length / 2)] : 0n; };

export function assessRisk(offer: Offer, meta: OfferMeta, payout: bigint, facts: ChainFacts, policy: EarlyPayPolicy, supplierHistory: bigint[] = []): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const add = (code: string, severity: RiskFlag['severity'], detail: string) => flags.push({ code, severity, detail });
  switch (facts.offerCheck) {
    case 'ok': break;
    case 'PayoutMismatch': add('PAYOUT_MISMATCH', 'reject', `Invoice payout ${offer.payout} differs from the supplier's registered address ${facts.registeredPayout ?? '(unknown)'}: possible payment-redirection fraud.`); break;
    case 'BadSignature': add('BAD_SIGNATURE', 'reject', 'Offer is not signed by the supplier it names.'); break;
    case 'AlreadySettled': add('DUPLICATE', 'reject', 'This invoice has already been paid.'); break;
    case 'NotRegistered': add('NOT_REGISTERED', 'reject', 'Supplier has not registered a payout address.'); break;
    case 'OfferExpired': add('OFFER_EXPIRED', 'reject', 'The supplier\'s early-payment offer has expired.'); break;
    case 'PayoutCoolingDown': add('PAYOUT_COOLDOWN', 'escalate', 'Supplier payout address changed recently and is still in its cooldown.'); break;
    default: add('INVALID_OFFER', 'reject', `Ledger rejected the offer: ${facts.offerCheck}.`);
  }
  if (facts.invoiceUsedInVault) add('DUPLICATE', 'reject', 'The vault has already paid this invoice hash.');
  if (!facts.agentActive) add('AGENT_INACTIVE', 'escalate', 'The agent\'s capability is revoked or expired.');
  if (!facts.vaultAllowsPayout) add('NOT_APPROVED_SUPPLIER', 'escalate', 'Supplier is registered but the owner has not approved it on the vault (two-key rule).');
  if (payout > facts.maxPayment) add('OVER_PAYMENT_LIMIT', 'escalate', 'Payment exceeds the vault\'s per-payment limit.');
  if (payout > facts.remainingBudget) add('OVER_BUDGET', 'escalate', 'Payment exceeds the agent\'s remaining lifetime budget.');
  if (payout > facts.dailyRemaining) add('OVER_DAILY_LIMIT', 'escalate', 'Payment exceeds what the agent may still spend today.');
  if (payout > facts.vaultBalance) add('INSUFFICIENT_FUNDS', 'escalate', 'Vault balance is below the payout.');
  const m = median(supplierHistory);
  if (m > 0n && offer.faceAmount > m * BigInt(policy.anomalyMultiple)) add('AMOUNT_ANOMALY', 'escalate', `Invoice is more than ${policy.anomalyMultiple}× this supplier's usual amount.`);
  const injected = findInjection(meta);
  if (injected) add('INSTRUCTION_IN_INVOICE', 'info', `Invoice text contains instructions ("${injected}"); treated as data and ignored.`);
  return flags;
}
