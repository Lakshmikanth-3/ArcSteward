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

No earlier hackathon project. ArcSteward EarlyPay was built during Tameion. It runs on a USDC spending-limit vault I wrote earlier in October (deployed on Arc mainnet, where an AI agent paid in real USDC). The vault was submitted to the Arc Microgrants program; no awards or grants have been received from Circle or Canteen. This is my first Canteen hackathon.

What I built in the last two weeks: the payables agent that makes money, not just pays bills.
- EarlyPayLedger (new Arc contract): suppliers sign their own payout address and invoices through a gasless relay; every agent decision is written to a hash-chained log.
- The decision agent: compares the discount's annual return with what the cash earns held, checks liquidity, screens for bank-detail scams, duplicates, new suppliers, hidden instructions and over-limit amounts, and decides PAY EARLY, HOLD (with a counter-offer the supplier accepts in one tap), ESCALATE or REJECT. An LLM chooses only within the limits set by the math.
- Two-key rule, owner-paid escalations (HUMAN_APPROVED), and live supplier, company and audit pages at arcsteward.vercel.app.

Usage (on-chain, Arc testnet): 32+ invoices paid early by the agent (87.8+ USDC, about 60 days early), 108+ signed invoices, 12 held, 26+ attacks refused, 96 escalations reviewed. This is my own testing so far; real outside suppliers: TODO (update before submitting).

Why it matters: the agent does not just spend safely, it earns money for the business by capturing early-payment discounts (2% for 60 days early is about 12% a year), and the vault makes sure it can never be tricked into paying the wrong account.

## Problem Statement

Suppliers wait 30–90 days to get paid while the buyer's cash sits idle; 47% of US small businesses have invoices more than 30 days overdue, and those owed money are owed about $17,500 on average (QuickBooks Small Business Late Payments Report 2025). Paying early is a well-known return (standard 2/10 net 30 terms are worth about 37% a year to the buyer), and dynamic discounting platforms, an estimated $2–6B market, offer it to large enterprises, but runs on slow bank rails and heavy onboarding. At the same time, "our bank details changed, pay this account" fraud caused $2.77B in reported US losses in 2024, the second-largest loss category (FBI IC3 2024), and companies now want AI agents to pay bills, which makes an agent with payment authority the ideal target for that fraud. The compelling part: with instant, near-free USDC settlement on Arc, paying early can become continuous and automatic, if an agent can decide which invoices are worth it and cannot be talked into paying the wrong account.

## Project Description

**The payables agent that makes money, not just pays bills.** ArcSteward's agent reads supplier early-payment offers and decides, invoice by invoice, whether paying early earns more than holding the cash. 2% for 60 days early is about 12% a year; idle cash earns about 4.5%. When the deal is good it pays in seconds on Arc; when it isn't, it holds and makes a counter-offer (the lowest discount it would pay today), which the supplier accepts in one tap. Discount captured so far: 32+ invoices paid early on Arc testnet. Safety (signed payouts, vault limits, a hash-chained record) is what lets it act alone, but the product is the return.

How it works:
1. A supplier registers its payout address and submits an invoice with an early-pay discount from a phone. It only signs (EIP-712); a relayer pays gas. No app, no gas.
2. The buyer approves the supplier's own registered address on its ArcSteward vault (the **two-key rule**: a redirection attacker would need both the supplier's key and the owner's key; address changes also wait a cooldown).
3. The treasury agent reads offers from Arc, computes the discount's annualised return (2% for 60 days = 12.17%), compares it with the hold yield plus a margin, checks the 30-day liquidity runway and risk flags (payout mismatch, duplicate, over-limit, unusual amount, instructions hidden in invoice text), and decides PAY_EARLY, HOLD (with a counter-discount), ESCALATE or REJECT. An LLM (gpt-oss-120b via Groq) chooses and explains within a deterministic ceiling; it never computes money and can never pick a riskier option than the policy allows.
4. PAY_EARLY pays through `ArcVault.pay` in about a second; ESCALATE goes to the owner, who can pay from their own wallet (recorded as HUMAN_APPROVED). Every decision, with its numbers and reason, is written to a hash-chained log on Arc that the audit page verifies in the browser.

Tech: Solidity (OpenZeppelin EIP712/ECDSA), Arc testnet and mainnet, USDC (payments and gas), viem, Next.js 16, an OpenAI-compatible LLM (Groq), Vercel. Idle-cash yield is a labelled simulation because USYC minting on Arc testnet needs Circle allowlisting; EURC is on the roadmap.

Proof: testnet end-to-end, 14/14 steps with real transactions (pay early, hold, redirect rejected, duplicate rejected, prompt injection ignored, over-limit escalated and paid by the owner, audit valid), plus a hostile-LLM adversarial test showing no USDC ever reaches an unapproved address.

## Traction

Numbers from `pnpm earlypay:stats` (on-chain events only), Oct 17 2026:

- Real usage (outside the team): 0 suppliers so far; product went live at arcsteward.vercel.app on Oct 17. TODO: update if real suppliers onboard before submitting.
- Automated testing on Arc testnet: 108 signed invoices from 42 test suppliers across 8 buyer vaults; 32 paid early by the agent (87.81 USDC, 60 days early on average, 1.79 USDC discount captured); 12 held (discount below hurdle); 26 attacks / bad invoices rejected; 96 escalations (16 owner-approved, 16 declined); decision hash chain valid on every vault.
- Earlier ArcSteward vault: an AI agent paying on Arc mainnet in real USDC under on-chain limits.

## Project Source Code

https://github.com/Lakshmikanth-3/ArcSteward

**Diff of code written during the event:** https://github.com/Lakshmikanth-3/ArcSteward/compare/359a435...main
(The repository's first commit, Oct 14, already falls inside the event window and contains the earlier vault work; 359a435 is the state submitted to Arc Microgrants, before EarlyPay and the redesign.)

## Project Live

https://arcsteward.vercel.app/earlypay

## Project Video Demo

https://youtu.be/e9RG-Uaeqkw

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
