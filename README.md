# Velo402 on Arc

**Velo402 gives autonomous AI agents restricted authority to spend USDC through an owner-controlled vault.** Owners define spending limits, authorized recipients and expiration rules, and can revoke permissions. The Arc deployment provides programmable, policy-enforced payments with verifiable on-chain transactions.

- **Live app:** https://velo402.vercel.app
- **Security proof:** https://velo402.vercel.app/security
- **Builder:** https://github.com/Lakshmikanth-3

---

## The problem

AI agents increasingly need to pay for things: APIs, data, compute, other agents. Today you either give an agent a private key (it can spend everything) or you keep a human in the loop for every payment (it is not autonomous). Prompt injection makes the first option dangerous: one malicious web page or tool result can tell the agent to send funds elsewhere.

## The solution

The owner puts USDC in a **vault contract** on Arc and grants an agent a **capability**:

| Rule | Example |
| --- | --- |
| Lifetime budget | 5 USDC total |
| Per-payment ceiling | 0.50 USDC per payment |
| Daily limit | 1 USDC per UTC day, so a stolen key drains slowly and the owner has time to revoke |
| Recipient allowlist | only `0xAPI…`, `0xData…`, editable one at a time |
| Merchant registry (opt-in) | any merchant approved in a curated on-chain registry |
| Gas allowance | the agent may draw up to 0.2 USDC for its own gas (USDC is Arc's gas token) |
| Expiry | valid for 24 hours |
| Revocation | owner can cancel at any moment |

The agent signs its own payments, so it stays autonomous. The vault contract checks every rule **inside the same transaction that moves the USDC**. If a rule fails, the transaction reverts and nothing moves. A manipulated agent, or a thief with the agent's key, can only ever do what the owner allowed.

## Why Arc

- **USDC is the gas token.** The agent needs only USDC: no second token to buy, price or top up.
- **Dollar-denominated budgets.** Limits, fees and payments are all in the same stable unit.
- **Fast, cheap finality** suits many small machine-to-machine payments (the "402 Payment Required" pattern the name refers to).
- **Standard EVM:** Solidity, viem and any EVM wallet work unchanged.

## What's included

- **Contracts:** vault, factory (several vaults per owner) and merchant registry.
- **AI agent** ([`app/agent/ai-agent.ts`](app/agent/ai-agent.ts)): an LLM agent with `get_budget`, `buy_resource` and `pay` tools. Works with any OpenAI-compatible API (Groq free tier by default, or Ollama locally with no key).
- **HTTP 402 pay-per-request API** ([`/api/x402/...`](app/src/app/api/x402)): returns `402` with an invoice; the agent pays from its vault; the server verifies the USDC transfer on Arc before serving data.
- **Agent SDK** ([`sdk/`](sdk)): `@velo402/arc-sdk`, with `pay`, `check`, `ensureGas`, `invoiceId` and `fetchWithPayment`.
- **Owner alerts:** webhook (Discord, Slack, Zapier), Telegram, and live in-app alerts.
- **Console:** multi-wallet discovery (EIP-6963), multiple vaults, policy templates, spending dashboard by agent and recipient, explorer fallback for history.
- **Developers page** (`/developers`): quickstart, comparison with other agent wallets, use cases, roadmap.

---

## Architecture

```
 Owner wallet (browser)                        Agent (server / AI runtime)
        │  create, deposit, authorize,                │  pay(recipient, amount, invoiceHash)
        │  setRecipient, setRegistry,                 │  topUpGas(amount)
        │  revoke, withdraw                           │  signed with the agent's own key (SDK)
        ▼                                             ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │ ArcVaultFactory ── createVault() ──► ArcVault (many per owner)     │
 │   ArcVault holds USDC and a Capability per agent:                 │
 │   maxTotal · maxPayment · maxPerDay · gasAllowance · expiresAt    │
 │   + versioned recipient allowlist + used invoice hashes           │
 │ MerchantRegistry ── curated merchants vaults can opt into         │
 └──────────────────────────────────────────────────────────────────┘
        │ events: Funded · Authorized · RecipientSet · Paid · GasToppedUp · Revoked · Withdrawn
        ▼
 Web console + x402 API (Next.js, viem) · alerts (webhook, Telegram) · Arc explorer
```

### Internal components

| Path | What it is |
| --- | --- |
| [`contracts/arc/ArcVault.sol`](contracts/arc/ArcVault.sol) | Vault, factory and merchant registry. OpenZeppelin `SafeERC20` and `ReentrancyGuard`. Immutable: no admin, no upgrades. |
| [`sdk/`](sdk) | `@velo402/arc-sdk`: verifies chain, bytecode, token and decimals, pre-checks then sends `pay()`, never auto-retries (avoids double payment), HTTP 402 client. |
| [`app/agent/ai-agent.ts`](app/agent/ai-agent.ts) | LLM agent with payment tools. |
| [`app/agent/watch.ts`](app/agent/watch.ts) · [`alerts.ts`](app/agent/alerts.ts) | Owner alerts to webhook and Telegram. |
| [`app/src/app/api/x402`](app/src/app/api/x402) | Pay-per-request API with on-chain payment verification. |
| [`app/agent/arc-runner.ts`](app/agent/arc-runner.ts) | CLI agent that uses the SDK. Mainnet spends need an explicit confirmation variable. |
| [`app/src/components/ArcConsole.tsx`](app/src/components/ArcConsole.tsx) | Owner and agent console: connect wallet, create/fund vault, authorize, pay, revoke, event history. |
| [`app/src/app/security`](app/src/app/security/page.tsx) | Threat model and live testnet receipts. |
| [`app/scripts/arc-deploy.ts`](app/scripts/arc-deploy.ts) | Preflight and deploy of the factory. |
| [`app/scripts/*.test.*`](app/scripts) | Contract, adversarial, SDK, UI and live testnet tests. |

### External dependencies

| Dependency | Use |
| --- | --- |
| Arc mainnet (chain 5042) / testnet (5042002) | Official RPC `rpc.mainnet.arc.io` / `rpc.testnet.arc.io` |
| USDC ERC-20 interface `0x3600…0000` | 6-decimal token the vault holds; native gas uses the same balance at 18 decimals |
| Arc Explorer | Every receipt in the UI links to it |
| Any injected EVM wallet | Signs owner and agent transactions in the browser |
| Circle faucet | Free testnet USDC |
| Vercel | Hosts the web app |

### Payment flow, step by step

1. **Owner** calls `factory.createVault()` and receives a vault bound to their address.
2. **Owner** approves the exact amount and calls `vault.deposit(amount)`.
3. **Owner** calls `vault.authorize(agent, policy, recipients[])` with `policy = { maxTotal, maxPayment, maxPerDay, gasAllowance, expiresAt, useRegistry }`. A new allowlist version is created; spend already used is kept. Single recipients can be added or removed later.
4. **Agent** calls `vault.pay(recipient, amount, invoiceHash)`. The contract checks, in order: active → not expired → recipient allowed → non-zero → invoice unused → ≤ per-payment ceiling → ≤ remaining budget → ≤ remaining today → ≤ balance. Then it records spend and transfers USDC. `topUpGas(amount)` follows the same budget and daily rules plus the gas allowance.
5. **Owner** can `revoke(agent)` at any time and `withdraw(amount)` remaining funds back to the owner address.

---

## Security: the agent cannot be manipulated into overspending

The agent key can call only `pay()` and `topUpGas()`, and both enforce the owner's policy on-chain. Full threat model: [`/security`](https://velo402.vercel.app/security) and [`docs/ARC_SECURITY.md`](docs/ARC_SECURITY.md).

| Attack | Blocked by |
| --- | --- |
| Pay more than allowed per payment | `PaymentLimit` |
| Spend fast after a key theft | `DailyLimit` |
| Drain through gas top-ups | `GasLimit` |
| Follow a prompt injection to pay an attacker | `RecipientDenied` (shown live by the AI agent run) |
| Drain the vault over many payments | `TotalLimit` (spend stored on-chain) |
| Pay itself or an attacker | `RecipientDenied` (allowlist) |
| Replay a payment | `DuplicatePayment` |
| Pay after expiry / revocation | `Expired` / `Unauthorized` |
| Raise its own limits, add recipients, change registry, withdraw, un-revoke | `NotOwner` |
| Reentrancy | `ReentrancyGuard` |

**Proof:**

- `scripts/arc-adversarial.test.mjs` runs hundreds of random attack transactions per seed (oversized amounts, foreign recipients, replayed IDs, gas drains, owner-only calls, day rollovers, revocations). After **every** round it checks that on-chain spend equals the sum of permitted payments and gas top-ups, stays within budget and gas allowance, the attacker holds zero and the agent holds only its permitted gas.
- `scripts/arc-testnet-e2e.test.ts` repeats the attacks against the real Arc testnet with real transactions.
- `scripts/arc-x402.test.ts` proves forged, tampered and cross-resource payment proofs are rejected by the API.

**Not yet:** an independent audit. The contracts are small and heavily tested; an audit is the next milestone before large balances.

---

## Run it

```bash
cd app
pnpm install
cp .env.example .env.local      # fill in NEXT_PUBLIC_ARC_* values
pnpm dev                        # http://localhost:3000
```

### Tests

```bash
pnpm arc:test            # contract flow + adversarial invariant test (local EVM)
ARC_FUZZ_SEED=7 pnpm arc:test   # re-run the attacker with another seed
pnpm arc:testnet:setup   # create dedicated testnet keys in ignored .env.arc-testnet
pnpm arc:testnet:e2e     # full end-to-end on Arc testnet with real transactions
X402_BASE_URL=http://localhost:3000 pnpm arc:testnet:x402   # pay-per-request API, incl. forged proofs
pnpm arc:testnet:browser # clicks through the live site on Arc testnet
pnpm arc:ready           # everything above + read-only mainnet preflight -> docs/MAINNET_READINESS.md
E2E_BASE_URL=https://velo402.vercel.app pnpm test:e2e e2e/arc-live.spec.ts   # live site checks
```

### Test manually in the browser (Arc testnet)

1. Install an EVM wallet (MetaMask or Rabby) and create **two** accounts: *Owner* and *Agent*.
2. Get free test USDC for both from https://faucet.circle.com (choose Arc Testnet).
3. Open https://velo402.vercel.app/testnet and click **Connect EVM wallet** with the *Owner* account. If asked, click **Switch to Arc Testnet** and approve it in the wallet.
4. **Create my vault** and confirm. The vault address fills in.
5. Enter `1` as the amount, then **Approve exact amount and deposit**. Vault balance shows 1 USDC.
6. Pick a policy template or paste the *Agent* address, set budget `0.5`, per payment `0.2`, put the *Owner* address as the permitted recipient, choose an expiry an hour ahead, then **Authorize / update**.
7. Switch the wallet to the *Agent* account and reconnect. Enter amount `0.1`, recipient = Owner, any payment ID, then **Pay USDC**. A `Paid` event appears with a receipt link.
8. Try to break it as the agent: amount `0.3` (over the per-payment limit), a different recipient, or the same payment ID again. Each is rejected before signing and would revert on-chain.
9. Switch back to *Owner*, click **Revoke immediately**, then try paying as the agent again: rejected.
10. As *Owner*, **Withdraw to owner** to recover the remaining USDC.

### Run the AI agent

```bash
# Free LLM: create a key at console.groq.com (no card), or run Ollama locally.
LLM_API_KEYS=gsk_a,gsk_b,gsk_c ARC_NETWORK=testnet ARC_VAULT_ADDRESS=0x... pnpm arc:ai-agent
# Several keys rotate automatically on rate limits. --every 30 runs a task every 30 minutes.
# Ollama: LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=llama3.1
# No LLM: add --scripted to run the same tools in a fixed order.
```

### Alerts

Set `ALERT_WEBHOOK_URL` and/or `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`, then `ARC_VAULT_ADDRESS=0x... pnpm arc:watch`. The SDK also sends an alert for every blocked payment.

### Deploy

See [`docs/ARC_DEPLOYMENT.md`](docs/ARC_DEPLOYMENT.md). Mainnet spending requires `ARC_MAINNET_CONFIRM=I_CONFIRM_MAINNET_SPEND`, set deliberately for each run.

---

## Repository layout

```
contracts/arc/          Solidity vault, factory, registry, compiled artifacts, deployment records
sdk/                    @velo402/arc-sdk agent SDK
app/                    Next.js web app, x402 API, AI agent, scripts and tests
docs/                   Deployment, security and testnet reports
```

## License

MIT
