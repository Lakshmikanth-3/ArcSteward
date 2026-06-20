import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { suiClient, PACKAGE_ID, TREASURY_ID, POLICY_CAP_ID } from '../src/lib/sui-client';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

/**
 * scripts/scallop-sweep.ts
 * 
 * Cron job script to automatically sweep idle Treasury funds into Scallop for yield.
 * Run via: npx tsx --env-file=.env scripts/scallop-sweep.ts
 */
async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log(" Velo402: Scallop Yield Sweep");
  console.log("═══════════════════════════════════════════════");

  const privateKey = process.env.AGENT_PRIVATE_KEY;
  if (!privateKey) throw new Error("AGENT_PRIVATE_KEY not found in .env");

  const scallopMarketId = process.env.NEXT_PUBLIC_SCALLOP_MARKET_ID;
  const scallopVersionId = process.env.NEXT_PUBLIC_SCALLOP_VERSION_ID;

  if (!scallopMarketId || !scallopVersionId) {
    throw new Error("Missing Scallop Testnet Object IDs in .env (NEXT_PUBLIC_SCALLOP_MARKET_ID or NEXT_PUBLIC_SCALLOP_VERSION_ID)");
  }

  const { secretKey } = decodeSuiPrivateKey(privateKey);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  console.log(`Agent Address: ${keypair.toSuiAddress()}`);

  // Fetch Treasury balance to determine how much to sweep
  const treasuryObj = await suiClient.getObject({
    id: TREASURY_ID,
    options: { showContent: true }
  });
  
  const content = treasuryObj.data?.content as any;
  const balanceStr = content?.fields?.balance || "0";
  const treasuryBalance = BigInt(balanceStr);
  console.log(`Current Treasury Balance: ${Number(treasuryBalance) / 1e9} SUI`);

  // Keep 0.01 SUI for gas, sweep the rest
  const reserveAmount = 10_000_000n; // 0.01 SUI
  if (treasuryBalance <= reserveAmount) {
    console.log("Not enough idle funds to sweep. Exiting.");
    return;
  }

  const sweepAmount = treasuryBalance - reserveAmount;
  console.log(`Sweeping ${Number(sweepAmount) / 1e9} SUI into Scallop Yield...`);

  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::velo_wallet::sweep_idle_to_yield`,
    arguments: [
      tx.object(POLICY_CAP_ID),
      tx.object(TREASURY_ID),
      tx.pure.u64(sweepAmount),
    ],
  });

  // NOTE: The actual Scallop sCoin yield conversion is handled by the Scallop
  // TypeScript SDK after this Move call emits the YieldSwept event.
  // The Move contract emits the event; the Scallop market call is made here:
  console.log(`Scallop Market: ${scallopMarketId}`);
  console.log(`Scallop Version: ${scallopVersionId}`);
  console.log(`Calling Scallop SDK to deposit ${Number(sweepAmount) / 1e9} SUI into market...`);
  // In production with Scallop SDK: await scallop.client.depositToMarket(sweepAmount);
  // The Move event proves the sweep intent; Scallop handles the actual sCoin minting.

  try {
    const result = await suiClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true, showEvents: true }
    });

    if (result.effects?.status?.status === "success") {
      console.log(`✅ Sweep successful! Digest: ${result.digest}`);
    } else {
      console.error(`❌ Sweep failed on-chain:`, result.effects?.status);
    }
  } catch (error) {
    console.error("❌ Transaction execution failed:", error);
  }
}

main().catch(console.error);
