# Mainnet readiness report

Run 2026-10-15T00:59:31.999Z against https://velo402.vercel.app. Testnet suites use real Arc testnet transactions; mainnet checks are read-only.

| Check | Result | Detail | Time |
| --- | --- | --- | --- |
| TypeScript typecheck | PASS | ok | 12s |
| Production build | PASS | ok | 38s |
| Compiled ABI matches contract source | PASS | ok | 5s |
| No secrets tracked in git | PASS | ok |  |
| Contract + attacker tests (seed 402) | PASS | pass 12+2 | 432s |
| Contract + attacker tests (seed 7) | PASS | pass 12+2 | 402s |
| Contract + attacker tests (seed 99991) | PASS | pass 12+2 | 378s |
| Browser UI on local chain | PASS | pass 1 | 41s |
| Testnet end-to-end (real transactions) | PASS | pass 15 | 78s |
| HTTP 402 API on live site (incl. forged proofs) | PASS | pass 7 | 16s |
| AI agent, scripted: prompt injection blocked by vault | PASS | ok | 21s |
| AI agent, LLM (Groq, key rotation) | PASS | ok | 24s |
| Live site pages and testnet console | PASS | ok | 16s |
| Browser click-through on live site (testnet) | PASS | pass 1 | 81s |
| Mainnet RPC is Arc chain 5042 | PASS | chain 5042 |  |
| Mainnet USDC has 6 decimals | PASS | 0x3600000000000000000000000000000000000000 |  |
| Mainnet deployer key in app/.env | FAIL | ARC_DEPLOYER_PRIVATE_KEY missing |  |
| Mainnet spend lock is off until you approve | PASS | ARC_MAINNET_CONFIRM must be set only for the approved run |  |

**Not ready: 1 check(s) failing.**
