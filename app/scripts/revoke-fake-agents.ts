/**
 * scripts/revoke-fake-agents.ts
 * 
 * Permanently burns the 3 fake swarm PolicyCap objects that were minted
 * by the old mint-swarm.ts script to placeholder addresses (0x111, 0x222, 0x333).
 * 
 * Run with:  npx tsx --env-file=.env scripts/revoke-fake-agents.ts
 */
import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

const PACKAGE_ID = process.env.NEXT_PUBLIC_VELO402_PACKAGE_ID!;
const OWNER_CAP_ID = "0x887894462e1ddcb6468ceba3e754d625740211802682efcda3c9e4f7c95d45fe";
const DEPLOYER_KEY = process.env.AGENT_PRIVATE_KEY!;

// The 3 fake PolicyCap IDs visible on the dashboard
const FAKE_POLICY_CAP_IDS = [
  "0xaed8ebb457dabda730ae76447a090686ae1b17b742a702fa66805a1880353ff2",
  "0xc580be057abf10418e839ccc87b2cb61ebc54cb30002b9f5262c501b44899ec2",
  "0xf7727a9e0f5927ce4fc02f268bd8f4c99d01573260af5d5c31eafc1bf0ac1849",
];

async function main() {
  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });
  const { secretKey } = decodeSuiPrivateKey(DEPLOYER_KEY);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);

  console.log(`Revoking ${FAKE_POLICY_CAP_IDS.length} fake agents...`);

  // Revoke each one in a separate transaction to avoid object conflicts
  for (const policyCapId of FAKE_POLICY_CAP_IDS) {
    console.log(`\nRevoking: ${policyCapId}`);
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::velo_wallet::revoke_policy`,
        arguments: [
          tx.object(OWNER_CAP_ID),
          tx.object(policyCapId),
        ],
      });

      const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === "success") {
        console.log(`  ✓ Revoked! Digest: ${result.digest}`);
      } else {
        console.error(`  ✗ Failed:`, result.effects?.status);
      }
    } catch (err) {
      console.error(`  ✗ Error revoking ${policyCapId}:`, err);
    }
  }

  console.log("\nDone. Refresh your Mission Control dashboard.");
}

main().catch(console.error);
