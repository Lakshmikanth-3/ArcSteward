# Arc testnet report (v2 contracts)

Arc Testnet, chain ID 5042002. All addresses and hashes below are real and can be checked on https://explorer.testnet.arc.io.

## Deployment

| Contract | Address |
| --- | --- |
| ArcVaultFactory | `0x5f8ff982221709bb9e85fa0eb793e305491d0fb1` (tx `0x66af367e…cade97fb`) |
| MerchantRegistry | `0xb29d4bf988430337113898607b4095e12f49b1c3` |
| Demo vault (AI agent + x402) | `0xf9eeA5a7D70Bd5F0D4d8170Ba5D7E0Ac1718e1e6` |
| Demo merchant | `0xd3C4374e22a1B886F8c93975bC641b1D7A1f0460` |

The live app reads `app/src/lib/arc/testnet-deployment.json`, which the end-to-end suite updates with its latest receipts.

## Results

| Suite | Command | Result |
| --- | --- | --- |
| Contract tests (local EVM) | `pnpm arc:test` | 10 / 10, including daily limit, gas allowance, recipient edits, registry, multiple vaults |
| Randomized attacker, 300 rounds | `pnpm arc:test` with `ARC_FUZZ_SEED` = 402, 7, 99991 | Pass on all seeds (236 / 249 / 255 attacks blocked, 0 leaks) |
| Live testnet end-to-end | `pnpm arc:testnet:e2e` | 15 / 15 with real transactions |
| HTTP 402 API | `pnpm arc:testnet:x402` | 7 / 7, including forged, tampered and cross-resource proofs |
| AI agent, scripted mode | `pnpm arc:ai-agent --scripted` | Bought 2 resources with real payments; injected 5 USDC payment to `0x…dEaD` blocked with `RecipientDenied` |
| Browser UI (local chain) | `pnpm arc:test:ui` | Pass |

The AI agent's LLM mode needs `LLM_API_KEY` (Groq free tier) or a local Ollama; it uses the same tools and SDK as the scripted run.

## Previous version

The v1 contracts (single limit set, one vault per owner) are recorded in `contracts/arc/deployments/v1-*.json` for history. They are superseded and not used by the app.
