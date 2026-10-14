# Velo402 — Arc Agent Vault

Tagline: Let agents pay in USDC while contracts keep owners in control.

Requested short description (for the deployed build):

Velo402 gives autonomous AI agents restricted authority to spend USDC through an owner-controlled vault. Owners define spending limits, authorized recipients and expiration rules, and can revoke permissions. The Arc deployment demonstrates programmable, policy-enforced payments with verifiable on-chain transactions.

Status: the description is demonstrated by the real testnet implementation. Mainnet deployment/payment remains pending; do not use it as a current mainnet deployment claim.

Velo402 adds a capability-scoped USDC vault on Arc to an existing agent wallet project. An owner creates and funds a vault, authorizes a separate agent address with a lifetime budget, per-payment ceiling, recipient allowlist and expiry, and can revoke immediately. The agent signs payments from its own account; the vault validates every payment on-chain and emits receipts that reviewers can inspect independently. Failed transfers roll back accounting, and unique payment IDs prevent duplicate execution.

Arc implementation: immutable Solidity vault/factory, USDC ERC-20 accounting at six decimals, viem wallet console at `/arc`, dedicated server agent SDK/CLI, contract events, preflight/deployment/smoke scripts. Arc pays gas in native USDC at eighteen decimals. Native and token views are never summed.

Repository: https://github.com/Lakshmikanth-3/velo-arc.

Public live demo: **PENDING — no verified link**.

Builder profile: https://github.com/Lakshmikanth-3 (public GitHub profile of the repository owner, verified accessible).

Verified mainnet factory/vault addresses: **PENDING — no Arc mainnet deployment performed**.
These placeholders refer to MAINNET. Real testnet addresses are recorded separately in `docs/arc-testnet-evidence.json`.

Successful mainnet deployment/payment hashes: **PENDING — none available**.

Source verification: **NOT PERFORMED**. External audit: **NOT PERFORMED**.

The Sui treasury, PolicyCap, Seal/Walrus, Nautilus, DeepBook, Guardian and Scallop remain Sui-only. Rooster's independent Base settlement remains separate. Neither demonstrates Arc integration. Arc has no migrated trading/yield, encrypted data delivery or AI inference integration.

## Acceptance checklist

- [x] Pasted program terms reviewed; official URL remains https://dorahacks.io/hackathon/arc-microgrants/build.
- [x] Arc code published to https://github.com/Lakshmikanth-3/velo-arc.
- [ ] Working Arc mainnet factory and vault, actual receipt/state checked.
- [ ] Positive real mainnet agent USDC payment with independently verifiable receipt.
- [ ] Public live `/arc` URL and full wallet flow tested by reviewer.
- [ ] Capability limits and revocation demonstrated against deployed contracts.
- [x] Public builder profile supplied through the repository owner's GitHub profile.
- [x] No prior Circle/Arc funding, confirmed by user on 2026-10-14.
- [ ] Accurate submission description, limitations and evidence links completed.

Local compile, build or tests do not establish eligibility. Do not submit this draft as a claim that mainnet acceptance criteria are complete.

Deadline from the supplied rules: October 14, 2026, 23:59 ET = October 15, 2026, 09:29 IST. Program dates can change; recheck before submission. One submission per project. The work must be yours or you must have submission rights. Payout recipients are subject to private verification and sanctions/restricted-jurisdiction screening. A mainnet USDC receiving wallet is required for payout. No company, traction, pitch deck or roadmap is required; hackathon projects and pseudonymous builders can qualify.
