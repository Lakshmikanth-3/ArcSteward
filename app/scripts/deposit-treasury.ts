/**
 * scripts/deposit-treasury.ts
 * One-shot: splits 0.1 SUI from the active Sui CLI keypair and deposits
 * it into the Velo402 Treasury shared object.
 *
 * Run: npx tsx scripts/deposit-treasury.ts
 */
import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

// ── Config ────────────────────────────────────────────────────────────────────
const PACKAGE_ID = process.env.NEXT_PUBLIC_VELO402_PACKAGE_ID!;
const TREASURY_ID = process.env.NEXT_PUBLIC_TREASURY_ID!;
const DEPOSIT_MIST = BigInt(100_000_000); // 0.1 SUI

// ── Keypair ───────────────────────────────────────────────────────────────────
// Re-uses the agent key for demo — replace with operator key for production.
// The deposit() function does NOT require OwnerCap — anyone can fund the treasury.
const OPERATOR_KEY = process.env.AGENT_PRIVATE_KEY!;

async function main() {
  if (!PACKAGE_ID || !TREASURY_ID || !OPERATOR_KEY) {
    console.error(
      "Missing env vars. Check NEXT_PUBLIC_VELO402_PACKAGE_ID, NEXT_PUBLIC_TREASURY_ID, AGENT_PRIVATE_KEY",
    );
    process.exit(1);
  }

  const client = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl("testnet"),
    network: "testnet",
  });
  const { secretKey } = decodeSuiPrivateKey(OPERATOR_KEY);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);

  console.log(`Sender:   ${keypair.toSuiAddress()}`);
  console.log(`Treasury: ${TREASURY_ID}`);
  console.log(`Amount:   ${DEPOSIT_MIST} MIST (0.1 SUI)`);

  const tx = new Transaction();

  // Split 0.1 SUI from the gas coin
  const [depositCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(DEPOSIT_MIST)]);

  // Deposit into treasury (no OwnerCap required — public entry)
  tx.moveCall({
    target: `${PACKAGE_ID}::velo_wallet::deposit`,
    arguments: [tx.object(TREASURY_ID), depositCoin],
  });

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showEvents: true },
  });

  if (result.effects?.status?.status === "success") {
    console.log(`\n✅ Deposit successful!`);
    console.log(`   Digest: ${result.digest}`);
    console.log(`   Treasury now has 0.1 SUI deposited.`);
  } else {
    console.error("❌ Transaction failed:", result.effects?.status);
  }
}

main().catch(console.error);
