# Velo402 Arc implementation report — 2026-10-14

## Follow-up status

The original report below describes the first local-only delivery. The current project in `C:\HACK\arc` now includes real Arc testnet deployment, successful 0.01 USDC agent payments, real browser inspection of the deployed vault and eight passing enforcement checks against chain 5042002. See `ARC_REQUIREMENTS_AUDIT.md`, `ARC_TESTNET_READINESS.json` and `ARC_TESTNET_REPORT.md` for current evidence. Mainnet deployment and public hosting remain pending; the application is still not eligible for submission.

Implemented and tested locally. **Not Arc Microgrants-ready yet:** no real Arc testnet run, mainnet deployment/payment, public Arc demo URL, builder profile or verified source link exists from this work. No real funds were spent. No changes were pushed to GitHub.

## Source and architecture

Cloned public repository https://github.com/Lakshmikanth-3/velo402 at baseline `9168ca9`, into the current task's `work/velo402`, branch `codex/arc-vault`. The initial task workspace contained no repository. The attached master prompt and all three additional requirements were applied. Inspected the README, PRD/report, all four Move modules, dashboard/layout, Sui agent/SDK, Rooster settlement/configuration, tests, environment examples and recent Git history.

Added a Solidity ERC-20 USDC vault with an immutable owner, factory, versioned allowlists, cumulative spending preserved across updates/revocation, payment-ID replay protection, expiry, owner recovery withdrawals, SafeERC20 and ReentrancyGuard. All vault amounts use six decimals; native gas checks use eighteen. Mainnet defaults to chain 5042 and the official RPC. Production and testnet configuration remain separate.

Added `/arc` to the existing dashboard and made landing launch links lead there. An injected EVM wallet signs owner/agent operations. The console simulates calls, waits for real receipts, reads balances and policies, and paginates actual contract events. Wallet changes require reconnecting. Arc revocation controls are distinct from the Sui kill switch. Added a dedicated Arc agent SDK/CLI; existing Sui agent APIs are preserved and not reused for Arc signing. No private signing credentials enter frontend code.

## Created or changed files

Created:

- `contracts/arc/ArcVault.sol`, `contracts/arc/TestToken.sol` (local-only mock).
- `app/src/app/arc/page.tsx`; `app/src/lib/arc/config.ts`, `abi.ts` (generated), `errors.ts`, `config.test.ts`.
- `app/agent/arc-sdk.ts`, `arc-runner.ts`.
- `app/scripts/arc-compile.mjs`, `arc-contract.test.mjs`, `arc-sdk.test.ts`, `arc-ui.test.ts`, `arc-deploy.ts`, `arc-smoke.ts`, `arc-readiness.ts`.
- `app/e2e/arc.spec.ts`.
- `docs/ARC_MIGRATION_PLAN.md`, `ARC_DEPLOYMENT.md`, `ARC_SECURITY.md`, `ARC_DEMO_SCRIPT.md`, `ARC_MICROGRANTS_SUBMISSION.md`, `ARC_EXECUTION_REPORT.md`, `ARC_READINESS.json`, `arc-evidence.example.json`.

Changed: `README.md`, `.gitignore`, `app/.env.example`, `app/package.json`, `app/pnpm-lock.yaml`, `app/src/app/page.tsx`, `app/src/components/SidebarLayout.tsx`. No Move contract or Rooster settlement implementation was changed. No fabricated addresses/hashes were inserted. Compiled artifacts are generated locally and ignored by Git.

## Tests actually executed

| Check | Result |
|---|---|
| Frozen baseline dependency installation | First attempt failed with ECONNRESET; lower-concurrency pnpm installation succeeded |
| Solidity compile (`node scripts/arc-compile.mjs` / `pnpm arc:compile`) | PASS: solc 0.8.30, optimizer 200, EVM paris, OpenZeppelin 5.4.0 |
| `node --test scripts/arc-contract.test.mjs` | PASS: 8 node:test entries (parent plus 7 cases), full local owner/agent flow and enforcement |
| `pnpm exec tsx --test src/lib/arc/config.test.ts` | PASS: six-decimal parsing, precision rejection, bigint, separate gas decimals and network selection |
| `pnpm exec tsx --test scripts/arc-sdk.test.ts` | PASS: local HTTP EVM reads, signed payment, remaining budget, duplicate rejection, revocation, chain mismatch |
| `pnpm arc:test:ui` | PASS: Chromium owner create/deposit/authorize, agent payment, owner revocation and rejected subsequent payment; actual local contract state and event history checked |
| `pnpm exec playwright test e2e/arc.spec.ts --workers=1` | PASS: disconnected/disabled controls, missing evidence and absent-wallet feedback |
| `pnpm test` | PASS: all 104 existing Rooster unit tests |
| `pnpm typecheck` / `pnpm exec tsc --noEmit` | PASS |
| ESLint scoped to new Arc modules/scripts and changed sidebar | PASS |
| Full `pnpm lint` | FAIL: 40 errors, 26 warnings in inherited Sui/legacy files; no new Arc errors. Baseline independently checked using the same installed lint tooling. |
| `pnpm build` | PASS: Next.js production build includes `/arc`; existing Rooster dynamic-file tracing warning remains |
| `pnpm arc:readiness --online` | Expected incomplete exit 1: mainnet RPC read returned 5042; factory/payment/live URL/profile evidence missing, eligibility false |

The initial contract harness failed to decode Ganache revert errors; corrected to assert raw revert selectors. Browser tests caught an undefined-account owner comparison; corrected before the passing run. Full browser test uses a disposable unlocked local signer shim with realistic gas estimation, not a real wallet extension or Arc node. It also drove readable rejection handling and uncached latest-block history refresh. Ganache's optional native uWS binary is unavailable on this Node/Windows version; its JS fallback successfully ran the tests.

Local contract coverage includes creation/funding, authorization updates, valid and cumulative spending, allowlisting, duplicate IDs, expiry, revocation, unauthorized callers/withdrawals, insufficient funds, failed token transfer rollback, malicious-token reentrancy callbacks and invalid inputs. Full existing Sui browser suite, Move tests and live Base/Arc tests were not run; they require separate environments and are not claimed as passed.

## Verification status and limitations

- Local contracts, SDK and browser flow run against a disposable Ganache EVM. Next.js builds successfully. Default `/arc` cannot operate on real Arc until a factory is deployed/configured.
- Real Arc testnet deployment/testing: **not performed**; no funded wallet or credentials supplied.
- Arc mainnet deployment/payment: **not performed**; separately confirmed step required by the user's master prompt.
- Verified mainnet contract addresses/payment hashes: **none**. Generated local test addresses are not Arc evidence and are excluded from submission fields.
- Public Arc hosting link: **none**; hosting access was not supplied.
- Official Arc network/token docs verified. DoraHacks page retrieval failed; current program rules require manual review. The user's stated working-mainnet/live-link criteria are retained as mandatory.
- Unauthenticated public Arc signing API was intentionally avoided. The dedicated server agent takes an explicit request and signer; no migrated AI reasoning, trading, yield, encrypted-data delivery or x402 payment-challenge protocol is claimed for Arc.
- Prototype is unaudited. Owner is immutable with no recovery/rotation. Multiple capabilities do not reserve balances. Prompt injection can still waste an authorized budget. Revocation cannot reverse a completed or earlier-ordered payment. Inherited lint errors and Rooster tracing warning remain.

## Exact remaining actions

1. Review/apply the included patch to baseline `9168ca9` or use the source ZIP. Publish the changes to the public repository after review. The patch is a local deliverable, not a GitHub PR.
2. From `app`, install with `pnpm install --frozen-lockfile`, compile with `pnpm arc:compile`. Securely configure dedicated deployer/owner/agent keys; do not share them in chat.
3. Fund dedicated Arc testnet accounts via Circle Faucet; set `ARC_NETWORK=testnet` and testnet RPC. Run `pnpm arc:preflight`, `pnpm arc:deploy`, `pnpm arc:smoke`, then `pnpm arc:smoke --execute` with intentional recipient, unique ID and `ARC_SMOKE_USDC=0.01`. Inspect receipts, limits and recovery behavior.
4. Obtain separate human confirmation for the exact mainnet operation after reviewing the preflight's current gas estimate and selected signers/recipient/amount. Set the confirmation environment only after approval; use the mainnet commands in `ARC_DEPLOYMENT.md`. No numeric gas estimate is fabricated here because no deployer address was supplied.
5. Verify source on the official explorer where supported. Save actual manifests, addresses, receipt hashes and verification links. Independently inspect the positive `Paid` event.
6. Deploy the frontend through your hosting account with actual public mainnet factory configuration. Rebuild and manually test the complete owner-to-agent flow at the public `/arc` URL using an EVM wallet extension.
7. Supply public builder profile; copy/fill `docs/arc-evidence.example.json` as `docs/arc-evidence.json`; run `pnpm arc:readiness --online`. Check current DoraHacks requirements and complete `ARC_MICROGRANTS_SUBMISSION.md` with verified links.

The mainnet broadcast restriction comes directly from section 8 of the attached master prompt: “Do not automatically deploy contracts, broadcast a mainnet transaction, transfer real USDC, bridge assets, or spend funds without my explicit confirmation.” Implementation and local verification are complete enough to review; the funded-chain/hosting acceptance criteria remain open.
