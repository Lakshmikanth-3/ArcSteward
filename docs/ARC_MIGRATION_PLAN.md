# Arc migration plan

Inspected baseline: commit 9168ca9; Next.js 16.2.9, pnpm, viem, Sui Move treasury/PolicyCap, Sui API routes and agent SDK; independent Rooster Base Sepolia settlement. Existing reports describe Sui, not Arc. No Solidity tooling or Arc deployment evidence exists in the checkout.

Target: isolated Solidity ERC-20 USDC vault and permissionless factory, /arc console in the existing dashboard, dedicated Arc agent SDK and CLI. Owners connect an injected EVM wallet, create/fund vaults, authorize/revoke agents and withdraw. Agents sign their own bounded payments. Real receipts and contract logs supply history.

Tasks: compile with pinned solc/OpenZeppelin; test contracts on a local EVM; generate ABI; integrate viem wallet and SDK; add preflight/deployment/smoke/readiness scripts; run existing unit tests, typecheck, lint and build; document deployment and submission evidence.

Accounting: all vault deposits, budgets and payments use the ERC-20 interface at 0x3600000000000000000000000000000000000000, 6 decimals. Native gas uses 18 decimals. These are two views of the same balance and must not be added together. Mainnet: 5042, https://rpc.mainnet.arc.io. Testnet: 5042002, https://rpc.testnet.arc.io. Verified from official Arc Docs on 2026-10-14.

Limitations: no supplied signing credentials, funded test wallet, hosting access, live demo URL or builder profile. No broadcast without separate confirmation for mainnet. No eligibility, audit or live deployment claims. DoraHacks page retrieval failed; program terms require manual review. Preserve Move, Sui features and Rooster; no automatic cross-chain fallback. Local EVM tests do not prove Arc execution.
