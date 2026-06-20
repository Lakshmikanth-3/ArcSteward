import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";


const PACKAGE_ID = process.env.NEXT_PUBLIC_VELO402_PACKAGE_ID!;
const TREASURY_ID = process.env.NEXT_PUBLIC_TREASURY_ID!;
const OWNER_CAP_ID = "0x887894462e1ddcb6468ceba3e754d625740211802682efcda3c9e4f7c95d45fe";

const DEPLOYER_KEY = process.env.AGENT_PRIVATE_KEY!;

const pcr0Hex = process.env.EXPECTED_PCR0 ?? "c95820b48d15e72f24a3398a8c55846c673fbea5906c2c19e418f29280433cde504fdf48bfd87e7e21d370b3d01e21f2";
const pcr0Bytes = Array.from(Buffer.from(pcr0Hex, "hex"));

async function main() {
  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });
  const { secretKey } = decodeSuiPrivateKey(DEPLOYER_KEY);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);

  const tx = new Transaction();

  // Swarm config
  const agents = [
    { address: "0x1111111111111111111111111111111111111111111111111111111111111111", scopes: [1], name: "Data Agent" },
    { address: "0x2222222222222222222222222222222222222222222222222222222222222222", scopes: [2], name: "Spot Trader" },
    { address: "0x3333333333333333333333333333333333333333333333333333333333333333", scopes: [3], name: "Margin Hedger" },
  ];

  for (const agent of agents) {
    tx.moveCall({
      target: `${PACKAGE_ID}::velo_wallet::mint_policy`,
      arguments: [
        tx.object(OWNER_CAP_ID),
        tx.object(TREASURY_ID),
        tx.pure.u64(10_000_000_000n), // 10 SUI max
        tx.pure.u64(5000), // expiration epoch
        tx.pure.vector('u8', agent.scopes),
        tx.pure.bool(true),
        tx.pure.vector('u8', pcr0Bytes),
        tx.pure.address(agent.address),
      ],
    });
  }

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showEvents: true },
  });

  if (result.effects?.status?.status === "success") {
    console.log(`Swarm successfully minted! Digest: ${result.digest}`);
    result.events?.forEach(e => {
        if (e.type.includes("PolicyMintedEvent")) {
            console.log("Minted PolicyCap:", (e.parsedJson as any).policy_cap_id);
        }
    })
  } else {
    console.error("Failed:", result.effects);
  }
}

main().catch(console.error);
