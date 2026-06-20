import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { suiClient } from '../src/lib/sui-client';
const keypair = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.AGENT_PRIVATE_KEY!).secretKey);
const client = suiClient;

const PACKAGE_ID = process.env.NEXT_PUBLIC_VELO402_PACKAGE_ID!;
const TREASURY_ID = process.env.NEXT_PUBLIC_TREASURY_ID!;

const MAX_SPEND_MIST = 100_000_000_000n; // 100 SUI
const ONE_WEEK_EPOCHS = 10000n; // Set high so it never expires
const ALLOWED_SCOPES = new Uint8Array([1, 2, 3, 4]);
const pcr0Hex = process.env.EXPECTED_PCR0 || '';
const PCR0_BYTES = pcr0Hex.length >= 96
  ? new Uint8Array(pcr0Hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
  : new Uint8Array(48).fill(0); 

async function main() {
  const agentAddress = keypair.toSuiAddress();
  console.log('Minting new PolicyCap for existing Treasury:', TREASURY_ID);

  // We need the OwnerCap that the user owns
  const res = await client.getOwnedObjects({
    owner: keypair.toSuiAddress(),
    filter: { StructType: `${PACKAGE_ID}::velo_wallet::OwnerCap` },
    options: { showContent: true },
  });

  const ownerCapObj = res.data.find(
    (obj: any) => obj.data?.content?.fields?.treasury_id === TREASURY_ID
  );

  const OWNER_CAP_ID = ownerCapObj?.data?.objectId;
  if (!OWNER_CAP_ID) {
    console.error('Could not find OwnerCap in wallet');
    return;
  }
  
  const tx2 = new Transaction();
  tx2.moveCall({
    target: `${PACKAGE_ID}::velo_wallet::mint_policy`,
    arguments: [
      tx2.object(OWNER_CAP_ID),
      tx2.object(TREASURY_ID),
      tx2.pure.u64(MAX_SPEND_MIST),
      tx2.pure.u64(ONE_WEEK_EPOCHS),
      tx2.pure.vector('u8', Array.from(ALLOWED_SCOPES)),
      tx2.pure.bool(true),                       
      tx2.pure.vector('u8', Array.from(PCR0_BYTES)),
      tx2.pure.address(agentAddress),            
    ],
  });

  const r2 = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx2,
    options: { showEffects: true, showObjectChanges: true },
  });

  if (r2.effects?.status?.status !== 'success') {
    console.error('❌ mint_policy failed:', JSON.stringify(r2.effects?.status, null, 2));
    return;
  }

  const policyObj = r2.objectChanges?.find(
    (c: any) => c.type === 'created' && c.objectType?.includes('PolicyCap')
  ) as any;
  const POLICY_ID = policyObj?.objectId;
  console.log('✅ New PolicyCap:', POLICY_ID, '| Digest:', r2.digest);
  console.log(`\nUpdate your .env:\nNEXT_PUBLIC_POLICY_CAP_ID=${POLICY_ID}`);
}

main().catch(console.error);
