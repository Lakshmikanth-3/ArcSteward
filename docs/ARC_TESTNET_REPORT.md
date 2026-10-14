# Real Arc testnet verification — October 14, 2026

**Testnet succeeded. Mainnet eligibility remains incomplete.** The following evidence comes from Arc Testnet, chain ID 5042002, not a local simulator.

## On-chain deployment and payment

- Factory: `0xfbfb323cbc2d22a068553575d2221a70fb4aaa25`.
- Owner vault: `0x108273C1Db4865CE65644195aFAB844A834891C2`.
- Agent: `0x8c6aB528531EEBEAE0CA11EAEc46da55A4D213ba`.
- Factory deployment: [successful transaction](https://explorer.testnet.arc.io/tx/0x84351e7ccca65d7d9131704c16b918c34f8f7248b77eb237dc95fd0514cf5c02).
- Initial 0.01 USDC payment: [successful transaction](https://explorer.testnet.arc.io/tx/0xfc410c3062f9f0c9874ec9060ee2a64439b9d812271f8c6eb9af1c9e1cbe83b6), block `67183367`, amount `10000` six-decimal token units.
- Final enforcement-test 0.01 USDC payment: [successful transaction](https://explorer.testnet.arc.io/tx/0xc8d92bbf463dfc41a2c240580754b3aec9bd2ac845529413ec15c098b9afe8b1).
- Final revocation: [transaction](https://explorer.testnet.arc.io/tx/0xaaf6f75e776e808e5fcf37d58b372f92fb9de857bddd4031695bf5d93281acfb).
- Remaining test vault funds recovered: [withdrawal](https://explorer.testnet.arc.io/tx/0x0e0f095d44943a4638e6aa34ba64560fcee8fe6cb2c046db96f93ad25cdef9ed).

Payments were demonstrations back to the dedicated owner's test account, not commercial purchases. Circle faucet funded the disposable owner with 20 free test USDC after human CAPTCHA verification; the runner supplied 1 test USDC to the dedicated agent for gas. Native balances and gas use 18 decimals; vault payments exclusively use the 6-decimal ERC-20 interface. No mainnet transaction or real-money payment was broadcast.

## Live enforcement results

The final `pnpm arc:testnet:enforcement --execute` run passed all eight assertions using real deployed contract simulations:

| Check | Exact on-chain rejection |
|---|---|
| Revoked agent | Unauthorized |
| Per-payment ceiling | PaymentLimit |
| Recipient allowlist | RecipientDenied |
| Unauthorized caller | Unauthorized |
| Duplicate payment ID | DuplicatePayment |
| Exhausted lifetime budget | TotalLimit |
| Expired capability | Expired |
| Revocation after reauthorization | Unauthorized |

These invalid requests were simulated against the real testnet contract; they were not broadcast merely to generate failed receipts. Valid deployment/funding/grant/payment/revocation/withdrawal operations were broadcast and confirmed.

The first extended run stopped when a five-second grant expired before its authorization simulation completed. This was a test timing problem, not a bypassed contract check. The owner revoked the capability and recovered unspent test funds, then reran with a 30-second expiry window and waited for chain time before testing expiry. The final run passed. Public event history preserves every actual payment and recovery operation, including the first run's valid payment.

## Browser verification

Opened the running `/testnet` page through the browser-control tool, loaded the actual factory/vault/agent addresses and clicked **Refresh on-chain state and history**. The browser read Arc testnet directly and displayed:

- Correct chain ID 5042002 and testnet explorer links.
- Owner address from the deployed contract.
- Available vault balance 0 USDC after recovery.
- Agent active = false; lifetime spent = 0.03 USDC; remaining budget = 0 USDC.
- Actual Funded, Authorized, Paid, Revoked and Withdrawn events with receipt links.

Transactions were signed by dedicated server-side CLI signers. The in-app browser has no injected EVM wallet, so real testnet signing through a browser wallet extension was not performed. Browser reads are real chain integration; full local browser signing flow was separately exercised with a disposable local wallet shim by `pnpm arc:test:ui`.

## Automated checks

- `pnpm arc:test`: passed (8 contract test entries plus SDK and decimal tests).
- `pnpm arc:test:ui`: passed after isolating its Next.js build directory so it can coexist with the user's running dev server.
- TypeScript and scoped ESLint: passed.
- Production build: passed.
- `pnpm arc:readiness --online --testnet`: independently confirmed deployment creation input matches current compiler output, registered vault, successful positive Paid event and public builder profile; correctly reports no mainnet eligibility.
- `pnpm arc:readiness --online`: correctly reports missing mainnet factory/payment, public live URL and published current Arc source.

## Submission requirements still open

Public current Arc source, a working public mainnet frontend, mainnet contracts and mainnet payment evidence remain required. GitHub push dry-run failed because no authenticated GitHub credentials were available; no source was pushed. No hosting credentials were supplied. Prior Circle/Arc funding was explicitly denied by the user, and the public repository owner's GitHub profile is linked in the app.

The supplied deadline is October 14, 2026, 23:59 ET / October 15, 2026, 09:29 IST; program dates may change. A testnet-only project is expressly ineligible. Mainnet broadcasting still requires separate explicit confirmation under the original master prompt.

Private test signer keys remain only in ignored, owner-restricted `app/.env.arc-testnet`. They are not included in source packages, patches, public evidence or browser data. Do not fund these test credentials on mainnet.
