# ArcSteward EarlyPay

**Suppliers get paid in seconds instead of 60 days, an AI decides which invoices are worth paying early, and the vault makes the payment impossible to hijack.**

Built during the Tameion Agents Hackathon (Sep 27 – Oct 17, 2026) on top of the existing ArcSteward vault. Live on **Arc testnet** at https://arcsteward.vercel.app/earlypay (supplier sign-up: https://arcsteward.vercel.app/earlypay/supplier); not deployed to mainnet.

## 1. Problem

- **Long payment terms starve suppliers.** Buyers pay on 30–90 day terms; small businesses and freelancers wait. (QuickBooks Small Business Late Payments Report 2025: 47% of 2,487 US small businesses had invoices more than 30 days overdue; those owed money were owed about $17,500 on average.)
- **The buyer's cash sits idle** for those 60 days, earning little.
- **Payment redirection fraud.** "Our bank details changed, pay this new account" (business email compromise) caused $2.77B of reported US losses in 2024, the second-largest loss category (FBI IC3 2024). An AI agent with payment authority is an obvious new target: one injected email can tell it to pay someone else.
- **Early payment is a known return:** standard "2/10 net 30" terms are worth about 37% a year to the buyer (simple annualisation). **Dynamic discounting platforms** (an estimated $2–6B market in 2025, estimates vary by scope) exist for enterprises, but run on slow bank rails, need heavy onboarding and do not let an AI agent decide safely.

If settlement is instant and nearly free (Arc + USDC), and an agent decides *which* invoices are worth paying early under limits it cannot exceed, early payment becomes continuous, automatic and safe.

## 2. Design

```
Supplier (phone) ── signs EIP-712 registration + offer ──▶ /api/earlypay/relay ──▶ EarlyPayLedger (Arc)
                                                                                     │ OfferSubmitted
Treasury agent ◀─────────────────────────────── reads events, vault state, supplier registry
   │  deterministic math + risk checks → LLM chooses within a ceiling → reason
   ├─ PAY_EARLY → ledger.recordPayEarly (offer must pass checkOffer) → ArcVault.pay → ledger.recordSettlement
   ├─ HOLD      → ledger.recordDecision (reason, counter-offer)
   ├─ ESCALATE  → ledger.recordDecision + owner alert → owner pays from own wallet → HUMAN_APPROVED + settlement
   └─ REJECT    → ledger.recordDecision + owner alert
Audit page ── recomputes the hash chain in the browser from on-chain events
```

- **No database.** Offers, invoice details, decisions, reasons and settlements are contract events. Every page and the agent read Arc directly.
- **Gasless suppliers.** A supplier's identity is a key generated in the browser; it only signs. The relayer (a dedicated testnet key) submits and pays gas. The contract verifies every signature, so the relayer cannot change what was signed.
- **Money only moves through ArcVault** (agent) or the **owner's own wallet** (human approval). The ledger never holds funds.
- **ArcVault, the factory and MerchantRegistry are unchanged** (byte-identical artifacts).

## 3. Contract: `contracts/arc/EarlyPayLedger.sol`

Testnet: [`0x97f61ef08f6a55fd417ffc8849cc9ba051baa8c0`](https://explorer.testnet.arc.io/address/0x97f61ef08f6a55fd417ffc8849cc9ba051baa8c0), payout cooldown 120 s (demo; 24 h intended for mainnet). No admin, no upgrades, no payable functions.

| Function | Who | Purpose |
| --- | --- | --- |
| `registerSupplier(payout, profileHash)` / `registerSupplierBySig(...)` | the supplier's key (or a relayer carrying its EIP-712 signature) | Set or change the payout address. A change restarts the **cooldown** before early payments may reach it. |
| `submitOffer(offer, signature, meta)` | anyone (relayer) | Publish a supplier-signed offer `{vault, supplier, invoiceHash, faceAmount, discountBps, payout, dueDate, expiry}` with untrusted invoice text. |
| `checkOffer(offer, signature)` | view | Reverts with `BadSignature`, `OfferExpired`, `NotRegistered`, `PayoutMismatch`, `PayoutCoolingDown` or `AlreadySettled`. |
| `recordPayEarly(offer, sig, inputsHash, prevHash, note)` | vault owner or active agent | Records PAY_EARLY only if `checkOffer` passes. |
| `recordDecision(vault, invoiceHash, offerHash, decision, inputsHash, prevHash, note)` | vault owner or active agent | HOLD / ESCALATE / REJECT / HUMAN_APPROVED. `prevHash` must equal the vault's chain head, so the log cannot fork. |
| `recordSettlement(vault, invoiceHash, payout, amount, paymentTx)` | vault owner or active agent | Links a payment to an invoice, once. |

`decisionHash = keccak256(abi.encode(vault, invoiceHash, offerHash, decision, inputsHash, prevHash, index))`. The audit page recomputes it in the browser.

## 4. Decision logic

All money is computed in code (`app/src/lib/earlypay/math.ts`, USDC base units as `bigint`). The LLM never does arithmetic that moves money.

- days early = ⌈(due − now) / 1 day⌉
- discount = face × discountBps / 10 000; payout = face − discount
- **discount APR = discount% × 365 / days early** (2% for 60 days = 12.17%; 1.5% for 50 days = 10.95%)
- hurdle = hold yield + margin (defaults: 4.5% simulated reserve rate + 2%)
- runway after = vault balance − payout − invoices due within 30 days; must stay ≥ the liquidity buffer
- proposed discount = smallest discount that clears the hurdle, clamped to the owner's min/max

Policy (the ceiling): any reject flag → REJECT; any escalate flag → ESCALATE; due now → HOLD; APR < hurdle → HOLD (with a counter-offer); runway < buffer → HOLD; else PAY_EARLY.
The LLM (OpenAI-compatible; Groq `gpt-oss-120b` by default) receives the computed context and may choose the ceiling or something more cautious (`PAY_EARLY → HOLD/ESCALATE`, `HOLD → ESCALATE`); an escalation always stays with the owner, and REJECT is reserved for hard rule violations. Anything else, malformed output or an LLM failure falls back to the policy decision, and the guardrail is written into the decision note. Before paying, the agent simulates `ArcVault.pay`; a refusal becomes an escalation.

## 5. Threat model

| Threat | Defence | Evidence |
| --- | --- | --- |
| Payment redirection ("bank details changed") | Payout must equal the supplier's self-registered address (`PayoutMismatch` → REJECT); address changes need the supplier's key and restart a cooldown; the owner must approve each payout on the vault (**two-key rule**) | e2e step 6; adversarial test |
| Duplicate invoice | `AlreadySettled` in the ledger, `DuplicatePayment` in the vault | e2e step 7 |
| Prompt injection in invoice text | Text is flagged and passed to the LLM as untrusted data; the LLM cannot exceed the policy ceiling; the vault only pays approved recipients (`RecipientDenied`) | e2e step 8; hostile-LLM adversarial test |
| Over-limit or unusual amount | Per-payment, daily and total limits enforced by ArcVault; amount anomaly flag → ESCALATE → owner decides | e2e step 9 |
| Agent key theft | The key can only call `pay()` / `topUpGas()` within limits and only to approved recipients; the owner can revoke at once | existing ArcVault tests |
| Forged or tampered offer | EIP-712 signature by the named supplier, checked on-chain | ledger tests |
| Log tampering | Hash chain anchored on Arc, recomputed in the browser | audit page |

## 6. Circle and Arc components

| Component | Use | Status |
| --- | --- | --- |
| **Arc** | Settlement layer; sub-second finality makes "paid today" mean now | testnet |
| **USDC** | Invoices, discounts, limits and payouts; also Arc's gas token, so the agent and relayer need nothing else | testnet |
| **ArcSteward vault** | On-chain per-payment, daily and total limits plus recipient allowlist for the agent | testnet (also live on mainnet from earlier work) |
| **USYC** | Yield on idle cash, the "hold" side of every decision | **Simulated.** USYC is on Arc testnet (token `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C`, Teller `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A`) but minting requires Circle allowlisting (support ticket, 24–48 h). The hold yield is a configurable rate labelled "simulated" in the UI, decision notes and docs. |
| **EURC** | European suppliers paid in euros | **Next.** ArcVault holds USDC only, so EURC would move outside the vault; not built into the core flow. |

## 7. Run it

```bash
cd app
pnpm earlypay:testnet:setup     # dedicated relayer + agent keys in .env.local, demo vault (testnet)
pnpm dev                        # /earlypay, /earlypay/supplier, /earlypay/buyer, /earlypay/audit
pnpm earlypay:agent --every 1   # treasury agent loop (or the "Run the agent now" button)
pnpm earlypay:testnet:e2e       # steps 1-11 with real testnet transactions (--llm for AI decisions)
pnpm earlypay:test              # ledger, engine and adversarial tests
pnpm earlypay:stats             # traction from chain events -> docs/TRACTION.md
```

## 8. Not done / simulated

- USYC sweep and redemption: simulated (allowlisting required).
- EURC: roadmap.
- HOLD invoices are recorded but not automatically paid at their due date.
- Owner policy settings (hurdle, buffer, discount range) are agent configuration (env), shown read-only in the buyer page.
- Invoice reading takes pasted text; PDF upload is not built.
- Testnet only. Mainnet deployment needs explicit owner confirmation.
