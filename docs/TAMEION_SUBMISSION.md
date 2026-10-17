# Tameion Agents Hackathon: submission answers (draft)

Fill the fields marked **TODO** yourself. Update Traction from `pnpm earlypay:stats` right before submitting.

**Email:** lakshmikanth.27csb@licet.ac.in

**Project Name:** ArcSteward EarlyPay

**Github Handle:** Lakshmikanth-3

**Discord Handle:** TODO

**Telegram Handle:** TODO

**Twitter / X:** TODO (optional)

**Number of Team Members:** 1 (Solo)

**Team Members Names:** TODO (your full name)

**Previous Canteen x Arc hackathons:** TODO. If none, write "None". (Arc Microgrants on DoraHacks is a Circle/Arc program, not a Canteen hackathon; mention it in the next answer.)

## Is this a continued project?

Yes. ArcSteward (formerly Velo402) started as an owner-controlled USDC vault for AI agents on Arc: an agent gets a capability with per-payment, daily and total limits, a recipient allowlist and an expiry, and the contract enforces them. That base (vault, factory, merchant registry, agent SDK, HTTP 402 pay-per-request API and an AI agent paying on Arc mainnet) was built in mid-October 2026 and submitted to the Arc Microgrants program. No awards or grants have been received from Circle or Canteen so far. TODO: correct this if anything changed.

During Tameion I built **EarlyPay**, a new product on top of that vault, without changing the deployed vault contracts:
- `EarlyPayLedger.sol` (Arc testnet): supplier registry with self-signed payout addresses and a change cooldown, EIP-712 early-payment offers, a gasless relay, and an append-only, hash-chained decision log.
- An AI treasury agent that decides, per invoice, PAY_EARLY / HOLD / ESCALATE / REJECT from deterministic math (discount APR vs hold yield, 30-day liquidity runway) and risk checks, with an LLM choosing and explaining within a policy ceiling.
- Supplier (phone, no gas), buyer (two-key approval, escalations paid by the owner) and audit (browser-verified hash chain) pages, live at arcsteward.vercel.app.
- A testnet end-to-end suite (14/14 steps with real transactions) and a live real-browser end-to-end test.

Why it matters for the broader project: the vault proved that an agent's spending authority can be enforced on-chain. EarlyPay is the first business workflow built on it, where the agent makes a real treasury decision with real money and the guardrails decide what is possible. It turns the vault from infrastructure into a product for finance teams and their suppliers.

## Problem Statement

Suppliers wait 30–90 days to get paid while the buyer's cash sits idle; 47% of US small businesses have invoices more than 30 days overdue, and those owed money are owed about $17,500 on average (QuickBooks Small Business Late Payments Report 2025). Paying early is a well-known return (standard 2/10 net 30 terms are worth about 37% a year to the buyer), and dynamic discounting platforms, an estimated $2–6B market, offer it to large enterprises, but runs on slow bank rails and heavy onboarding. At the same time, "our bank details changed, pay this account" fraud caused $2.77B in reported US losses in 2024, the second-largest loss category (FBI IC3 2024), and companies now want AI agents to pay bills, which makes an agent with payment authority the ideal target for that fraud. The compelling part: with instant, near-free USDC settlement on Arc, paying early can become continuous and automatic, if an agent can decide which invoices are worth it and cannot be talked into paying the wrong account.

## Project Description

ArcSteward EarlyPay is an AI treasury agent that pays supplier invoices early in exchange for a discount, only when the math beats holding the cash, through a vault whose limits it cannot break.

How it works:
1. A supplier registers its payout address and submits an invoice with an early-pay discount from a phone. It only signs (EIP-712); a relayer pays gas. No app, no gas.
2. The buyer approves the supplier's own registered address on its ArcSteward vault (the **two-key rule**: a redirection attacker would need both the supplier's key and the owner's key; address changes also wait a cooldown).
3. The treasury agent reads offers from Arc, computes the discount's annualised return (2% for 60 days = 12.17%), compares it with the hold yield plus a margin, checks the 30-day liquidity runway and risk flags (payout mismatch, duplicate, over-limit, unusual amount, instructions hidden in invoice text), and decides PAY_EARLY, HOLD (with a counter-discount), ESCALATE or REJECT. An LLM (gpt-oss-120b via Groq) chooses and explains within a deterministic ceiling; it never computes money and can never pick a riskier option than the policy allows.
4. PAY_EARLY pays through `ArcVault.pay` in about a second; ESCALATE goes to the owner, who can pay from their own wallet (recorded as HUMAN_APPROVED). Every decision, with its numbers and reason, is written to a hash-chained log on Arc that the audit page verifies in the browser.

Tech: Solidity (OpenZeppelin EIP712/ECDSA), Arc testnet and mainnet, USDC (payments and gas), viem, Next.js 16, an OpenAI-compatible LLM (Groq), Vercel. Idle-cash yield is a labelled simulation because USYC minting on Arc testnet needs Circle allowlisting; EURC is on the roadmap.

Proof: testnet end-to-end, 14/14 steps with real transactions (pay early, hold, redirect rejected, duplicate rejected, prompt injection ignored, over-limit escalated and paid by the owner, audit valid), plus a hostile-LLM adversarial test showing no USDC ever reaches an unapproved address.

## Traction

TODO, replace with the output of `pnpm earlypay:stats` (the "Real usage" column) right before submitting. Report only real people; the repo separates automated test runs from real usage.

Current honest status: the product went live at arcsteward.vercel.app on Oct 17. Real usage so far: **0** suppliers outside the team (all activity so far is automated testing: 58 test invoices, 25 paid). Add: number of real suppliers onboarded, invoices submitted and paid early, USDC paid, any feedback quotes, GitHub stars and social posts.

## Project Source Code

https://github.com/Lakshmikanth-3/ArcSteward

**Diff of code written during the event:** https://github.com/Lakshmikanth-3/ArcSteward/compare/359a435...main
(The repository's first commit, Oct 14, already falls inside the event window and contains the earlier vault work; 359a435 is the state submitted to Arc Microgrants, before EarlyPay and the redesign.)

## Project Live

https://arcsteward.vercel.app/earlypay

## Project Video Demo

TODO: upload `demo/earlypay/ArcSteward_EarlyPay_Demo.mp4` to YouTube (unlisted) or Loom and paste the link.

## Arc OSS

Yes.

**Why choose this project / primitives exposed:**
- **Capability vault for agents** (`ArcVault.sol` + factory): per-payment, daily and lifetime USDC limits, recipient allowlist, gas allowance paid in USDC, expiry and instant revocation. Immutable, no admin. Any agent framework can use it as a spending wallet with on-chain guardrails.
- **EarlyPayLedger**: a reusable pattern for agent decisions you can audit: EIP-712 signed offers, gasless relay, a self-signed payee registry with a change cooldown (anti business-email-compromise), and a hash-chained decision log that can be recomputed in a browser.
- **Agent SDK** (`sdk/`): pre-checks every payment against the live contract, never auto-retries (no double pay), HTTP 402 client.
- **HTTP 402 pay-per-request** server and client for Arc ("velo402-vault" scheme), verifying payment on-chain before serving data.
- **Decision engine pattern**: deterministic money math plus an LLM constrained by a policy ceiling, with fallback, as a template for agentic finance.

Compared with the circlefin/arc-* examples, this adds on-chain spending policy for autonomous agents, a gasless signed-offer flow, an auditable agent decision log, and end-to-end tests against real Arc testnet transactions.

## Circle / Arc Feedback

What worked: USDC as the gas token removes a whole class of agent-wallet problems (no second token); fast finality makes "pay early" meaningful; standard EVM tooling (viem, OpenZeppelin, solc) worked unchanged; the testnet faucet and explorer were reliable.

Where it could improve:
- **RPC limits:** the public testnet RPC caps `eth_getLogs` at under 10,000 blocks, rate-limits bursts ("Request exceeds defined limit"), and load-balanced nodes sometimes lag at the chain head. Documenting the limits and offering an indexed events API would save every agent builder from writing a cache.
- **USYC on testnet:** minting needs allowlisting via a support ticket (24–48 h), which is hard to fit into a hackathon. A self-serve testnet allowlist or a faucet for USYC would let builders demo yield-aware agents for real.
- **EURC with programmable limits:** guidance or a reference for multi-currency spending policies would help.
- **Docs:** a single page listing per-network contract addresses (USDC, EURC, USYC, Teller) with whether each is live and what access it needs.

**Open to a 20-minute call:** Yes. TODO: confirm.

## General Feedback

TODO (your own words). Suggestions if useful: clear judging criteria and the Arc OSS showcase were helpful; a shared testnet USDC/USYC faucet for participants and earlier announcement of the submission form fields would help.
