# Arc Microgrants requirements audit

Based on the complete program text supplied by the user on October 14, 2026. Official URL: https://dorahacks.io/hackathon/arc-microgrants/build. Direct automated retrieval returned 405; the pasted terms are the audit source.

| Requirement or rule | Finding | Action |
|---|---|---|
| Already deployed and working on Arc mainnet at submission | NOT MET | Separately approve and perform mainnet deployment and verified payment after testnet success |
| Public live deployment link reviewers can open | NOT MET | Publish current frontend with actual mainnet configuration; localhost is insufficient |
| Public repository | MET | Arc source published at https://github.com/Lakshmikanth-3/velo-arc |
| Short description explaining project and Arc use | IMPLEMENTED | Exact user description added to homepage, metadata and submission draft with pending-deployment qualification |
| Public GitHub/X/Farcaster builder profile | MET | https://github.com/Lakshmikanth-3 is accessible and belongs to the given repo owner |
| Real Arc component, not a mockup/slide deck | IMPLEMENTED LOCALLY | Solidity vault/factory, actual viem transaction path, dedicated agent SDK, receipts and event reads; chain proof still needed |
| Testnet-only builds excluded | NOT MET UNTIL MAINNET | Testnet proof is development validation and never substituted for mainnet |
| No prior Circle/Arc program funding | CONFIRMED | User answered no prior Circle/Arc funding in this chat |
| Work owned or right to submit | OWNER DECLARATION | User supplied this as their existing GitHub project; final submission rights remain owner's responsibility |
| One submission per project | MANUAL | Submit once; software cannot verify all off-platform submissions |
| Worldwide subject to restricted-jurisdiction screening | PROGRAM REVIEW | Builder must satisfy program screening; no application code can establish this |
| Payout verification after conditional selection | PROGRAM REVIEW | Complete official private verification if selected |
| Wallet able to receive USDC on Arc | MANUAL | Select a secure mainnet receiving wallet; disposable test keys are not payout wallets |
| Closing date | DEADLINE | Supplied deadline is 2026-10-14 23:59 ET / 2026-10-15 09:29 IST; check for changes |
| Relevance, technical credibility, quality, further potential | REVIEWER JUDGMENT | Present enforced capabilities, actual receipts, clear UI and honest limitations |
| Company, traction, deck or roadmap | NOT REQUIRED | No unrelated deliverables added |
| Hackathon projects and pseudonymous builders | PERMITTED | No need to disclose identity publicly; payout verification is private |
| Ownership, no equity/IP assignment/exclusivity | PROGRAM TERMS | Grant terms preserve builder ownership |

## Implementation changes from this audit

Added shared project description/profile metadata, /submission readiness page, separate /testnet console, editable verified factory input, dedicated testnet setup/run commands, safe signer storage and a browser-test path that can read real testnet state. Existing owner/agent capability enforcement is already implemented and tested locally; no redundant trading, yield or AI inference feature is required by the program.

## Testnet procedure

The setup command creates disposable testnet owner/agent keys only in ignored `app/.env.arc-testnet`; keys are never displayed. Public addresses are recorded in `contracts/arc/deployments/testnet-wallets.json`. The official Circle faucet requires a human CAPTCHA to fund the owner. From `app`:

```sh
pnpm arc:testnet:setup
pnpm arc:testnet:run
# Only after faucet funding; the runner rejects all mainnet configurations:
pnpm arc:testnet:run --execute
```

The runner verifies chain ID 5042002 and token decimals, deploys the factory using existing deployment tooling, funds the dedicated testnet agent with 1 free test USDC for gas, runs a 0.01 test USDC smoke payment back to the owner, revokes the capability and records actual evidence. Pending manifests and existing vaults must be reconciled; no automatic repeat spending is performed. Visit `/testnet`, enter public factory/vault/agent addresses, and refresh to inspect real balance, budget, revocation and events. Signing in the browser requires an injected EVM wallet; the in-app browser does not automatically provide one.

Completed: live testnet deployment, payment, revocation, owner recovery, all eight enforcement simulations and browser verification of real chain state. `/testnet` now prefills the verified demo's public addresses. See `ARC_TESTNET_REPORT.md` for exact hashes and test results.

## Outstanding external steps

Arc source is published at https://github.com/Lakshmikanth-3/velo-arc. Public hosting still requires account access. Mainnet spending remains subject to separate confirmation. No amount of local/testnet implementation can substitute for these program requirements.
