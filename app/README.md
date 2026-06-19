# Velo402 Mission Control & Dashboard

This is the Next.js frontend and API backend for Velo402.

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can simulate incoming oracle data using the script:
```bash
npx tsx scripts/encrypt-and-publish-dataset.ts
```

## Known Testnet Limitations (Demo Environment)

Due to dependencies on third-party testnet infrastructure, the following compromises are present in the testnet deployment:

1. **DeepBook v3 Predict/Margin Pools:** DeepBook v3 was actively deploying on Testnet during development. If the Predict pool ID is unavailable or errors during the demo, the agent will gracefully fall back to executing a standard Spot trade.
2. **Scallop Move Testnet Stubbing:** Due to Scallop testnet package instability, the exchange rate for yield calculation is approximated in the dashboard using an estimated 2.5% APY mock. The production setup uses the official Scallop TS SDK.
3. **Nautilus EC2 Requirement:** The Nautilus `decision_gate.move` attestation check requires a physical AWS Nitro Enclave to generate the PCR0 hash. For the demo, `POST /api/compute/attest` runs in a `dev-mock` mode returning a structurally valid attestation that satisfies the Move `decision_gate` checks without requiring a live EC2 deployment.

## Demo Fallback Paths

To ensure the 4-minute continuous demo proceeds smoothly under testnet load:
- **402 Loop Finality:** The `/api/knowledge/sentiment` endpoint includes an exponential backoff retry to handle RPC indexing delays for the `PaymentEvent`.
- **Trade Failure:** If the DeepBook Predict transaction aborts, the agent will log the error and you can manually re-trigger a spot trade via the Provisioning UI.
- **Rate Limiting:** The daily limit demonstration should be shown *before* triggering the Kill Switch to avoid `EObjectNotFound` aborts overlapping with the `EOverDailyLimit` aborts.
