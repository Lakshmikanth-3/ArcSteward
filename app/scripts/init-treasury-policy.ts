/**
 * scripts/init-treasury-policy.ts
 * Initializes Treasury + OwnerCap + PolicyCap against the NEW package on testnet.
 * Run: npx tsx --env-file=.env scripts/init-treasury-policy.ts
 */
import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

const PACKAGE_ID = process.env.NEXT_PUBLIC_VELO402_PACKAGE_ID!;
const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';

const ONE_WEEK_EPOCHS = 10000n;
const MAX_SPEND_MIST = 1_000_000_000n; // 1 SUI

// Allowed scopes: 1=DATA_402, 2=DEEPBOOK_SPOT, 3=DEEPBOOK_MARGIN, 4=DEEPBOOK_PREDICT
const ALLOWED_SCOPES = new Uint8Array([1, 2, 3, 4]);

// PCR0 from .env (48-byte SHA-384)
const pcr0Hex = process.env.EXPECTED_PCR0?.replace(/"/g, '') || '00'.repeat(48);
const PCR0_BYTES = Array.from(Buffer.from(pcr0Hex, 'hex'));

async function main() {
  if (!PACKAGE_ID) throw new Error('NEXT_PUBLIC_VELO402_PACKAGE_ID missing');
  const privateKey = process.env.AGENT_PRIVATE_KEY;
  if (!privateKey) throw new Error('AGENT_PRIVATE_KEY missing');

  const { secretKey } = decodeSuiPrivateKey(privateKey);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(NETWORK), network: NETWORK });

  const agentAddress = keypair.getPublicKey().toSuiAddress();
  console.log('Package:', PACKAGE_ID);
  console.log('Agent:  ', agentAddress);

  // ── Step 1: create_treasury(label, ctx) ────────────────────────────────────
  console.log('\n[1/2] Creating Treasury...');
  const tx1 = new Transaction();
  tx1.moveCall({
    target: `${PACKAGE_ID}::velo_wallet::create_treasury`,
    arguments: [
      tx1.pure.vector('u8', Array.from(Buffer.from('velo402-knowledge', 'utf8'))),
    ],
  });

  const r1 = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx1,
    options: { showEffects: true, showObjectChanges: true },
  });

  if (r1.effects?.status?.status !== 'success') {
    console.error('❌ create_treasury failed:', JSON.stringify(r1.effects?.status, null, 2));
    return;
  }

  const treasuryObj = r1.objectChanges?.find(
    (c: any) => c.type === 'created' && c.objectType?.includes('::velo_wallet::Treasury')
  ) as any;
  const ownerCapObj = r1.objectChanges?.find(
    (c: any) => c.type === 'created' && c.objectType?.includes('::velo_wallet::OwnerCap')
  ) as any;

  const TREASURY_ID = treasuryObj?.objectId;
  const OWNER_CAP_ID = ownerCapObj?.objectId;
  console.log('✅ Treasury:', TREASURY_ID);
  console.log('✅ OwnerCap:', OWNER_CAP_ID, '| Digest:', r1.digest);

  if (!TREASURY_ID || !OWNER_CAP_ID) {
    console.error('Could not find Treasury or OwnerCap in object changes:');
    console.dir(r1.objectChanges, { depth: null });
    return;
  }

  // ── Step 2: mint_policy(owner, treasury, max_spend, expiration, scopes, attested, pcr0, agent) ─
  console.log('\n[2/2] Minting PolicyCap...');
  const tx2 = new Transaction();
  tx2.moveCall({
    target: `${PACKAGE_ID}::velo_wallet::mint_policy`,
    arguments: [
      tx2.object(OWNER_CAP_ID),
      tx2.object(TREASURY_ID),
      tx2.pure.u64(MAX_SPEND_MIST),
      tx2.pure.u64(ONE_WEEK_EPOCHS),
      tx2.pure.vector('u8', Array.from(ALLOWED_SCOPES)),
      tx2.pure.bool(true),                       // attested_compute_required
      tx2.pure.vector('u8', PCR0_BYTES),          // expected_pcr0
      tx2.pure.address(agentAddress),            // agent address receives PolicyCap
    ],
  });

  const r2 = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx2,
    options: { showEffects: true, showObjectChanges: true },
  });

  if (r2.effects?.status?.status !== 'success') {
    console.error('❌ mint_policy failed:', JSON.stringify(r2.effects?.status, null, 2));
    console.dir(r2, { depth: null });
    return;
  }

  const policyObj = r2.objectChanges?.find(
    (c: any) => c.type === 'created' && c.objectType?.includes('PolicyCap')
  ) as any;
  const POLICY_ID = policyObj?.objectId;
  console.log('✅ PolicyCap:', POLICY_ID, '| Digest:', r2.digest);

  // ── Print result ──────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════');
  console.log('✅ Add these to app/.env:');
  console.log(`NEXT_PUBLIC_TREASURY_ID=${TREASURY_ID}`);
  console.log(`NEXT_PUBLIC_POLICY_CAP_ID=${POLICY_ID}`);
  console.log('══════════════════════════════════════════════');
}

main().catch(console.error);
