/**
 * scripts/mint-policy.ts
 * Mints a PolicyCap for an already-existing Treasury + OwnerCap.
 * Run: npx tsx --env-file=.env scripts/mint-policy.ts
 */
import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

const PACKAGE_ID = process.env.NEXT_PUBLIC_VELO402_PACKAGE_ID!;
const TREASURY_ID = '0x9cd52cd75dbb9743b9b67a9366a019d5b2bc6595aa8424839a64d8a1d78129fa';
const OWNER_CAP_ID = '0x8e67dd0ea20f565e5e716c340ae0bf3cee54f5cd5b584368eb0a83ede0d0dac5';
const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';

const EXPIRY_EPOCH = 1224n;       // Current epoch 1134 + 90 days buffer
const MAX_SPEND_MIST = 1_000_000_000n;
const ALLOWED_SCOPES = new Uint8Array([1, 2, 3, 4]);
const pcr0Hex = (process.env.EXPECTED_PCR0 ?? '').replace(/"/g, '') || '00'.repeat(48);
const PCR0_BYTES = Array.from(Buffer.from(pcr0Hex, 'hex'));

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const { secretKey } = decodeSuiPrivateKey(process.env.AGENT_PRIVATE_KEY!);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(NETWORK), network: NETWORK });
  const agentAddress = keypair.getPublicKey().toSuiAddress();

  console.log('Package:', PACKAGE_ID);
  console.log('Treasury:', TREASURY_ID);
  console.log('OwnerCap:', OWNER_CAP_ID);
  console.log('Agent:', agentAddress);

  // Wait for indexer to catch up
  console.log('\nWaiting 3s for node indexer...');
  await sleep(3000);

  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::velo_wallet::mint_policy`,
    arguments: [
      tx.object(OWNER_CAP_ID),
      tx.object(TREASURY_ID),
      tx.pure.u64(MAX_SPEND_MIST),
      tx.pure.u64(EXPIRY_EPOCH),
      tx.pure.vector('u8', Array.from(ALLOWED_SCOPES)),
      tx.pure.bool(true),
      tx.pure.vector('u8', PCR0_BYTES),
      tx.pure.address(agentAddress),
    ],
  });

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });

  if (result.effects?.status?.status === 'success') {
    const policyObj = result.objectChanges?.find(
      (c: any) => c.type === 'created' && c.objectType?.includes('PolicyCap')
    ) as any;
    const POLICY_ID = policyObj?.objectId;
    console.log('\n✅ PolicyCap:', POLICY_ID, '| Digest:', result.digest);
    console.log('\n══════════════════════════════════════════════');
    console.log('Add to app/.env:');
    console.log(`NEXT_PUBLIC_TREASURY_ID=${TREASURY_ID}`);
    console.log(`NEXT_PUBLIC_POLICY_CAP_ID=${POLICY_ID}`);
    console.log('══════════════════════════════════════════════');
  } else {
    console.error('❌ Failed:', JSON.stringify(result.effects?.status, null, 2));
    console.dir(result, { depth: null });
  }
}

main().catch(console.error);
