# Velo402: policy-enforced USDC payments for AI agents, live on Arc

**Velo402 gives autonomous AI agents restricted authority to spend USDC through an owner-controlled vault.** Owners define spending limits, authorized recipients and expiration rules, and can revoke permissions at any time. The Arc deployment provides programmable, policy-enforced payments with verifiable on-chain transactions.

- Live app (Arc mainnet): https://velo402.vercel.app/arc
- Security proof: https://velo402.vercel.app/security
- Developers, SDK and HTTP 402 API: https://velo402.vercel.app/developers
- Source: https://github.com/Lakshmikanth-3/velo-arc

---

## 1. The problem

AI agents are starting to pay for things on their own: APIs, datasets, compute, and other agents. Today there are only two options, and both are bad:

```
 Option 1: give the agent a private key          Option 2: approve every payment by hand
 ─────────────────────────────────────          ───────────────────────────────────────
 Agent ──key──► Wallet ($$$)                     Agent ──request──► Human ──approve──► Wallet
   ▲                                                                  (slow, 24/7 impossible)
   └── one prompt injection or stolen key
       can drain everything                      Result: the agent is no longer autonomous
```

This is not hypothetical:

- **Bybit, February 2025:** the exchange's signers were tricked into approving a malicious transaction. About **$1.5 billion** was stolen in a single transfer. The keys never leaked; the approval was manipulated.
- **Freysa AI agent, November 2024:** an AI agent built to never release its prize pool was talked into doing exactly that by one persuasive message. About **$47,000** left the wallet.

When software holds a key, whoever can manipulate the software controls the money.

## 2. The solution

Velo402 moves the rules **out of the agent and into a smart contract** on Arc.

```
        OWNER (human or multisig)                         AI AGENT
              │ funds + sets policy                          │ signs its own payments
              ▼                                              ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │                      ArcVault (on Arc mainnet)                   │
   │                                                                  │
   │   USDC balance            Capability for this agent:             │
   │                           • lifetime budget                      │
   │                           • max per payment                      │
   │                           • max per day (rate limit)             │
   │                           • approved recipients / merchants      │
   │                           • gas allowance                        │
   │                           • expiry  •  revoke anytime            │
   └──────────────────────────────────────────────────────────────────┘
              │ every rule passes → USDC moves + receipt event
              │ any rule fails    → transaction reverts, nothing moves
              ▼
         Merchant / API / other agent
```

The agent stays fully autonomous: no human approves each payment. But the vault checks every rule **inside the same transaction that moves the money**.

## 3. Why the agent cannot be manipulated into overspending

The agent's key can call only two functions, `pay()` and `topUpGas()`, and both are bounded by the owner's policy. Every owner function (`authorize`, `setRecipient`, `setRegistry`, `revoke`, `withdraw`) checks `msg.sender == owner`.

| What a manipulated agent tries | What stops it (on-chain) |
| --- | --- |
| Pay more than allowed per payment | `PaymentLimit` |
| Drain the vault over many payments | `TotalLimit` (spend stored on-chain) |
| Spend fast after a key theft | `DailyLimit` |
| Pay itself or an attacker | `RecipientDenied` |
| Replay a paid invoice | `DuplicatePayment` |
| Pay after expiry or revocation | `Expired` / `Unauthorized` |
| Drain through gas top-ups | `GasLimit` |
| Raise its limits, add recipients, withdraw, undo revoke | `NotOwner` |

**Worst case, even with a stolen key: the agent can spend only what the owner allowed, only to approved recipients, only up to the daily limit, until the owner revokes it.**

Proof:
- **Randomized attacker test:** hundreds of malicious transactions per run (oversized amounts, foreign recipients, replays, gas drains, owner-only calls, day rollovers). After every single one, on-chain spend must equal the permitted payments, stay within all limits, and the attacker must hold 0 USDC. Passes on multiple random seeds.
- **Live on mainnet:** an injected 5 USDC payment to an attacker address is rejected with `RecipientDenied`.

## 4. Why Arc

- **USDC is the gas token.** The agent holds one dollar asset, so budgets, fees and payments share one unit, with no second token to buy or manage. The vault can even pay the agent's own gas from a capped allowance.
- **Low fees, fast finality.** Mainnet payments confirmed in under a second and cost under $0.01 in gas, which suits small machine-to-machine payments.
- **Public receipts.** Every authorization, payment and revocation is a verifiable event on the Arc explorer.
- **Standard EVM.** Solidity, viem and any EVM wallet work unchanged.

## 5. Architecture

```
 ┌───────────────────┐      createVault()       ┌──────────────────────┐
 │  Owner wallet     │ ───────────────────────► │  ArcVaultFactory     │
 │  (browser / Safe) │                          │  many vaults / owner │
 └─────────┬─────────┘                          └──────────┬───────────┘
           │ deposit · authorize · setRecipient            │ deploys
           │ setRegistry · revoke · withdraw               ▼
           │                                    ┌──────────────────────┐      approved?   ┌────────────────────┐
           └──────────────────────────────────► │  ArcVault            │ ◄──────────────► │  MerchantRegistry  │
                                                │  USDC + capabilities │                  │  curated merchants │
 ┌───────────────────┐   pay(to, amount, inv)   │  per agent           │                  └────────────────────┘
 │  AI agent         │ ───────────────────────► │                      │
 │  Velo402 SDK      │   topUpGas(amount)       └──────────┬───────────┘
 │  (own key)        │                                     │ events: Funded · Authorized · Paid
 └─────────┬─────────┘                                     │ GasToppedUp · Revoked · Withdrawn
           │ HTTP 402 pay-per-request                      ▼
           ▼                                    ┌──────────────────────┐
 ┌───────────────────┐   verifies Paid event    │  Arc RPC / Explorer  │
 │  Paid API (x402)  │ ───────────────────────► │                      │
 └───────────────────┘                          └──────────┬───────────┘
                                                           │ reads balances, events
                                                           ▼
                                                ┌──────────────────────┐
                                                │  Web console         │──► webhook / Telegram /
                                                │  velo402.vercel.app  │    in-app alerts
                                                └──────────────────────┘
```

### What `pay()` checks, in order

```
 pay(recipient, amount, invoiceHash)
   │
   ├─ capability active?            no → Unauthorized
   ├─ not expired?                  no → Expired
   ├─ recipient allowed?            no → RecipientDenied   (allowlist or opted-in registry)
   ├─ amount > 0, invoice set?      no → InvalidInput
   ├─ invoice not used before?      no → DuplicatePayment
   ├─ amount ≤ per-payment limit?   no → PaymentLimit
   ├─ amount ≤ remaining budget?    no → TotalLimit
   ├─ amount ≤ remaining today?     no → DailyLimit
   ├─ amount ≤ vault balance?       no → InsufficientFunds
   │
   └─ record spend → transfer USDC → emit Paid(agent, recipient, invoice, amount, budgetLeft)
```

## 6. How it works, step by step

```
  OWNER                                VAULT (Arc)                          AGENT
    │  1. createVault()                    │                                  │
    │ ───────────────────────────────────► │                                  │
    │  2. approve + deposit USDC           │                                  │
    │ ───────────────────────────────────► │                                  │
    │  3. authorize(agent, policy, list)   │                                  │
    │ ───────────────────────────────────► │                                  │
    │                                      │   4. pay(merchant, 0.01, inv)    │
    │                                      │ ◄─────────────────────────────── │
    │                                      │── checks all rules ──► USDC ──► merchant
    │                                      │   5. pay(attacker, 5, ...)       │
    │                                      │ ◄─────────────────────────────── │
    │                                      │── RecipientDenied, nothing moves │
    │  6. revoke(agent)  (any time)        │                                  │
    │ ───────────────────────────────────► │   7. pay(...) → Unauthorized     │
    │  8. withdraw(rest)                   │                                  │
    │ ───────────────────────────────────► │                                  │
```

### HTTP 402 pay-per-request (agent buying data)

```
 AI agent                          Paid API                         Arc
    │  GET /api/x402/arc-stats         │                              │
    │ ───────────────────────────────► │                              │
    │  402 Payment Required            │                              │
    │  {payTo, price, invoice}         │                              │
    │ ◄─────────────────────────────── │                              │
    │  vault.pay(payTo, price, keccak256(invoice))                    │
    │ ──────────────────────────────────────────────────────────────► │
    │  GET + X-PAYMENT: {txHash, invoice}                             │
    │ ───────────────────────────────► │  verify Paid event on-chain  │
    │                                  │ ───────────────────────────► │
    │  200 OK + data                   │                              │
    │ ◄─────────────────────────────── │                              │
```

## 7. What's built

| Component | What it does |
| --- | --- |
| **Smart contracts** | `ArcVault`, `ArcVaultFactory` (multiple vaults per owner), `MerchantRegistry`. OpenZeppelin SafeERC20 + ReentrancyGuard. Immutable: no admin key, no upgrades. |
| **Web console** | Connect any EVM wallet, create and fund vaults, policy templates, authorize agents, add or remove single recipients, merchant registry, pay, gas top-up, revoke, withdraw, spending dashboard, live event history and alerts. |
| **AI agent** | An LLM agent (free Groq models, key rotation, or local Ollama) with tools to check its budget, buy paid resources and pay. Tested live on Arc mainnet. |
| **HTTP 402 API** | A pay-per-request API that returns `402` with an invoice and serves data only after verifying the vault payment on Arc. Rejects forged, tampered and reused proofs. |
| **Agent SDK** | `@velo402/arc-sdk`: `pay`, `check`, `ensureGas`, `invoiceId`, `fetchWithPayment`. |
| **Owner alerts** | Webhook (Discord, Slack, Zapier), Telegram and in-app alerts for payments, gas draws, revocations and blocked attempts. |

## 8. Live on Arc mainnet (chain 5042)

| What | Address / transaction |
| --- | --- |
| ArcVaultFactory | `0x333af5f858a1cc267b6ab16e83bcb2fe28f8b2b1` |
| MerchantRegistry | `0x8ab3bc42d0d6630395cc9eea8f44de007efa026f` |
| AI agent's vault | `0xD0e065D4978F7614C3d6dA5b162fd25ed45c3C8F` |
| First AI-agent payment (0.01 USDC) | `0xee745efaace3a156f09ae07b4d9e1e47204075d8cf192114c378f01e6ee1eedd` |
| AI agent buying data over HTTP 402 | `0x4470348e6f53a9c648bdbc3e6e4ceee1d91786bbd3cd22420401879ab4446bf4`, `0x5111969c433bda26c9c80a8cdb6a3ab3c22653cbab8956b40107397a8dafef8f` |
| Console walkthrough payment (0.02 USDC) | `0x3ef190083bf8322e8514e6b24c43830915912358d134c4f801983268f11ff26e` |

All verifiable at https://explorer.arc.io.

## 9. Testing

| Suite | Result |
| --- | --- |
| Contract tests (local EVM) | 10 / 10 |
| Randomized attacker test, 3 seeds | 0 leaks |
| Live Arc testnet end-to-end | 15 / 15 real transactions |
| HTTP 402 API incl. forged proofs | 7 / 7 |
| Every console button and page link, real browser | 10 / 10 |
| Browser click-through on the live site | Pass |
| One-command readiness suite (`pnpm arc:ready`) | All checks pass |

## 10. Who it's for

- **Research agents** buying papers, datasets and search results per query.
- **Trading bots** paying for market data feeds, capped per day.
- **Agent marketplaces** where one agent hires another for a task.
- **Teams** giving each internal agent its own vault and budget.

## 11. What's next

- Escrow contract: pay on delivery, refund on timeout.
- Batched settlement for high-frequency micro-payments.
- WalletConnect for mobile wallets.
- Hosted team dashboard (paid plan), while the contracts stay free and open source.
- Independent security audit before large balances.
