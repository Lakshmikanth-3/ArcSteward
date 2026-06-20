# @velo402/sdk

**Velo402 Agent SDK** — Drop-in TypeScript client for autonomous AI agents to interact with the Velo402 capability wallet on Sui.

## Install

```bash
npm install @velo402/sdk
# or
pnpm add @velo402/sdk
```

## Quick Start

```typescript
import { Velo402Agent, SCOPES } from '@velo402/sdk';

const agent = new Velo402Agent({
  apiBase: 'https://your-velo402-deployment.vercel.app',
});

// Check remaining budget
const status = await agent.policyStatus();
console.log(`Remaining: ${Number(status.policy.remainingBudget) / 1e9} SUI`);

// Pay a 402 invoice and get the data
const { data, digest } = await agent.payAndFetch('/api/knowledge/sentiment');

// Run Guardian pre-flight check (real Pyth oracle)
const risk = await agent.guardianCheck({
  action: 'BUY',
  amountSui: 0.1,
  scopeTag: SCOPES.DEEPBOOK_SPOT,
});
if (risk.blocks.length === 0) {
  await agent.trade({ action: 'BUY', amountSui: 0.1, scopeTag: SCOPES.DEEPBOOK_SPOT });
}

// Run a full autonomous cycle
const result = await agent.runCycle({ tradeAmountSui: 0.05 });
```

## API Reference

### `new Velo402Agent(config?)`

| Field | Type | Default | Description |
|---|---|---|---|
| `apiBase` | `string` | `'http://localhost:3000'` | Base URL of the Velo402 Next.js app |
| `fetch` | `fetch` | `globalThis.fetch` | Custom fetch (for testing) |

### Methods

| Method | Returns | Description |
|---|---|---|
| `policyStatus()` | `PolicyStatus` | Live PolicyCap state + Treasury balance |
| `hasBudget(minSui?)` | `boolean` | Quick budget check |
| `guardianCheck(params)` | `GuardianResult` | Pyth-oracle risk pre-flight |
| `trade(params)` | `TradeResult` | DeepBook Spot/Margin/Predict |
| `payAndFetch(endpoint)` | `{data, digest}` | Full 402 pay-and-retry cycle |
| `yieldStatus()` | `YieldStatus` | Scallop APY + Pyth price |
| `sweepToYield(amountSui?)` | `SweepResult` | On-chain yield sweep |
| `getAttestation()` | `NautilusAttestation` | PCR0 enclave measurement |
| `runCycle(opts?)` | Cycle summary | Full autonomous loop |

### `SCOPES` constant

```typescript
SCOPES.DATA_402          = 1  // Pay HTTP 402 invoices
SCOPES.DEEPBOOK_SPOT     = 2  // SUI/DBUSDC spot orders
SCOPES.DEEPBOOK_MARGIN   = 3  // DEEP/SUI leveraged orders  
SCOPES.DEEPBOOK_PREDICT  = 4  // WAL/SUI predict positions
```

### `TESTNET_OBJECTS` constant

```typescript
TESTNET_OBJECTS.package  = '0xd88c09bd...'
TESTNET_OBJECTS.treasury = '0x9cd52cd7...'
TESTNET_OBJECTS.registry = '0xe2077a15...'
```

## Live Testnet Objects

| Object | Address |
|---|---|
| Package | `0xd88c09bd00a9891035fdb1e975ada7a4ae6c220f2ddc2b06771d9d7eeb278c69` |
| Treasury | `0x9cd52cd75dbb9743b9b67a9366a019d5b2bc6595aa8424839a64d8a1d78129fa` |
| DeepBook Spot Pool | `0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5` |
| DeepBook Margin Pool | `0x48c95963e9eac37a316b7ae04a0deb761bcdcc2b67912374d6036e7f0e9bae9f` |
| DeepBook Predict Pool | `0x8c1c1b186c4fddab1ebd53e0895a36c1d1b3b9a77cd34e607bef49a38af0150a` |
| Walrus Blob (Pyth data) | `_SBjvQk91_1Q71Zgp5R_pt72rqE5iDjP5kGioBTRkiQ` |
