# Arc deployment

Status: real Arc testnet factory/vault deployment and 0.01 USDC agent payment completed on October 14, 2026. Mainnet deployment, public hosting and source verification remain pending. Testnet evidence is in `contracts/arc/deployments/5042002*.json`; it does not establish mainnet readiness.

## Setup and local checks

Node 22+, pnpm 9.15.9. From `app`:

```sh
pnpm install --frozen-lockfile
pnpm arc:compile
pnpm arc:test
pnpm arc:test:ui
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm dev
```

Open `/arc`. The legacy Sui dashboard and Rooster remain separate routes. Configure `.env.local` for Next.js. CLI commands consume environment variables supplied by the shell, or use `pnpm exec tsx --env-file=.env scripts/arc-deploy.ts`. Never paste keys into a command argument, chat, browser field, screenshot or checked-in file. `.env` is ignored. `.env.example` contains only placeholders. Dedicated deployer, owner and agent accounts are recommended.

## Network and units

| Parameter | Mainnet | Testnet |
|---|---|---|
| Chain ID | 5042 | 5042002 |
| RPC | https://rpc.mainnet.arc.io | https://rpc.testnet.arc.io |
| Explorer | https://explorer.arc.io | https://explorer.testnet.arc.io |
| Native gas | USDC, 18 decimals | USDC, 18 decimals |
| ERC-20 interface | 0x3600000000000000000000000000000000000000, 6 decimals | same address, independent chain |

Sources checked 2026-10-14: [network](https://docs.arc.io/arc/references/connect-to-arc), [token interface](https://docs.arc.io/arc/references/contract-addresses), [deployment tutorial](https://docs.arc.io/arc/tutorials/deploy-contracts). The Circle deployment tutorial covers templates; this project deploys its own unaudited vault with viem. Native and ERC-20 balances represent the same USDC. Do not add them. `0.01` payment USDC = `10000` ERC-20 units; `0.01` native USDC = `10000000000000000` gas units. Solidity uses only ERC-20 units.

Compiler: solc 0.8.30, OpenZeppelin Contracts 5.4.0, optimizer 200, EVM paris. Recompile before deployment. The conservative EVM target avoids relying on newer opcodes. `TestToken` is local-test-only and must never be deployed or configured as production USDC.

## Testnet first

Set `ARC_NETWORK=testnet`, `ARC_RPC_URL=https://rpc.testnet.arc.io`, a securely supplied `ARC_DEPLOYER_PRIVATE_KEY` and `ARC_DEPLOYER_ADDRESS`. Obtain test USDC from [Circle Faucet](https://faucet.circle.com). The local development signers created for this work are stored in ignored `.env.arc-testnet`; do not use them for mainnet funds or payout.

```sh
pnpm arc:compile
pnpm arc:preflight
pnpm arc:deploy
```

Preflight reads RPC chain ID and token decimals, confirms the deployer address, estimates gas for the exact creation bytecode and constructor, checks native balance and prints a gas cost ceiling using 18 decimals. Default execution is read-only. Deployment writes `contracts/arc/deployments/5042002.json`, saving the transaction hash before waiting and validating success, bytecode and the configured token. A pending manifest must be reconciled before repeating. Factory creation is one transaction; owner vault creation is separate.

For a complete testnet smoke, configure a fresh funded `ARC_OWNER_PRIVATE_KEY`, a different funded `ARC_AGENT_PRIVATE_KEY`, `ARC_FACTORY_ADDRESS`, an intentional recipient, `ARC_SMOKE_USDC=0.01`, and a unique `ARC_PAYMENT_ID`. The amount is explicit, capped at 0.1 USDC. The agent needs its own native USDC for gas.

```sh
pnpm arc:smoke
pnpm arc:smoke --execute
```

Default smoke prints the selected operations without signing. Execution creates a new vault, approves exactly the deposit, deposits, authorizes, pays from the agent, revokes and simulates a rejected subsequent payment. It stores real receipt hashes in `5042002-smoke.json`. Fresh owners only; existing permissions are never overwritten by this script. If interrupted, inspect all printed hashes and revoke the agent manually. Testnet completion does not prove mainnet deployment.

## Separately approved mainnet step

The user's master prompt explicitly requires a separate confirmation before mainnet deployment or spending. Obtain that confirmation for the chosen deployer, owner, agent, recipient, amount and estimated costs. Do not interpret this documentation or local checks as approval.

Use the same commands with `ARC_NETWORK=mainnet` and `ARC_RPC_URL=https://rpc.mainnet.arc.io`. Run read-only preflight and review its current cost estimate first. Only after approval, set `ARC_MAINNET_CONFIRM=I_CONFIRM_MAINNET_SPEND` securely for the intended execution. Then:

```sh
pnpm arc:deploy
pnpm arc:smoke
pnpm arc:smoke --execute
```

No numerical cost estimate is claimed here: no configured funded deployer was supplied. Preflight prints an exact-bytecode estimate when an address is available. Smoke requires six transactions (including the agent payment); each wallet estimates its transaction fee, and fees change. Review all costs before approval. A payment amount is separate from gas charges.

## Frontend and agent

Set public `NEXT_PUBLIC_ARC_NETWORK=mainnet`, `NEXT_PUBLIC_ARC_RPC_URL`, and `NEXT_PUBLIC_ARC_FACTORY_ADDRESS` to the actual deployed factory. Rebuild with `pnpm build`; serve with `pnpm start` or your existing Next.js hosting pipeline. Point the public live link to `/arc`. No hosting account was connected here.

The owner uses an injected EVM wallet. Each operation simulates the real contract call, requests wallet confirmation and waits for a success receipt. Switch wallets to the authorized agent for a manual payment. Account/chain changes invalidate the UI session and require reconnection. History comes from paginated contract logs, initially the most recent 20,000 blocks, with earlier pages available.

For a server agent, set dedicated `ARC_AGENT_PRIVATE_KEY`, `ARC_VAULT_ADDRESS`, network/RPC, `ARC_PAYMENT_RECIPIENT`, `ARC_PAYMENT_USDC` and a **nonzero bytes32** `ARC_PAYMENT_ID`:

```sh
pnpm arc:agent
pnpm arc:agent --execute
```

Default reads state. Execution simulates, signs, waits and rereads the remaining budget. No retry loop. The UI hashes a human-readable payment ID with keccak256; the SDK accepts bytes32 directly. The smoke script hashes its human-readable ID. Preserve the ID and hash after uncertain results; inspect `usedPaymentIds` before retrying. No public signing endpoint is added.

## Verification and readiness

Use `contracts/arc/artifacts/solc-input.json` for source verification; compilation embeds all imported OpenZeppelin sources from the pinned package. Submit standard JSON, compiler `v0.8.30`, optimizer 200 and EVM paris to the official explorer's verification interface where available. Constructor ABI encodes the USDC address for factory, and owner/token for vault. A factory-created vault may require explorer contract-creation tracing for its constructor metadata. Save verification links only after confirmed success. Local compilation is not source verification.

Copy `docs/arc-evidence.example.json` to `docs/arc-evidence.json` and enter actual factory, vault, deployment/payment hashes, working public `/arc` URL and builder profile. Then:

```sh
pnpm arc:readiness --online
```

This independently checks chain 5042, a successful deployment whose input matches the local compiled creation code, factory token, registered vault, a positive `Paid` event in a successful receipt and an accessible console URL. It still marks reviewer flow and program eligibility as manual and exits nonzero. `ARC_READINESS.json` distinguishes PASS/MISSING/FAIL/MANUAL. An HTTP 200 response does not prove that the full wallet journey works.

## Troubleshooting and emergency recovery

- Wrong network: reconnect after switching, check both wallet and RPC chain ID. Never fall back to Base or Sui.
- RPC unavailable/rate limited: use a documented provider for the same chain. Keep log batches small. A failed history read is not an empty transaction history.
- Amount rejected: use a decimal string with at most six places. Never use JavaScript floating point to calculate payment units.
- Deposit approved but failed: allowance may remain. Inspect the deposit hash; reduce token allowance to zero in the owner's wallet if abandoning it.
- Uncertain receipt: reconcile the saved/printed hash before resubmitting. Do not clear manifests to bypass this.
- Agent compromised: owner sends `revoke(agent)` immediately, waits for confirmation and withdraws remaining funds. A payment already ordered before revocation may settle; revocation affects later transactions.
- Frontend faulty: stop publishing it, use the owner wallet and verified ABI to revoke and withdraw. Contracts are immutable; deploy a replacement factory/vault after review, migrate remaining funds intentionally and update the frontend only after verification. Owner keys cannot be recovered or rotated by this contract.
