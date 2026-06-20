/**
 * scripts/create-payment-registry.ts
 * Creates a PaymentRegistry shared object on-chain.
 * Run: npx tsx --env-file=.env scripts/create-payment-registry.ts
 */
import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

const PACKAGE_ID = process.env.NEXT_PUBLIC_VELO402_PACKAGE_ID!;
const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';

async function main() {
  if (!PACKAGE_ID) throw new Error('NEXT_PUBLIC_VELO402_PACKAGE_ID not found in .env');
  const privateKey = process.env.AGENT_PRIVATE_KEY;
  if (!privateKey) throw new Error('AGENT_PRIVATE_KEY not found in .env');

  const { secretKey } = decodeSuiPrivateKey(privateKey);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(NETWORK), network: NETWORK });

  const sender = keypair.getPublicKey().toSuiAddress();
  console.log('Package:', PACKAGE_ID);
  console.log('Sender: ', sender);
  console.log('\nCreating PaymentRegistry...');

  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::payment_kit::create_registry`,
    arguments: [tx.pure.string('velo402-knowledge')],
  });

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });

  if (result.effects?.status?.status === 'success') {
    console.log('\n✅ Transaction successful! Digest:', result.digest);
    const registry = result.objectChanges?.find(
      (c: any) => c.type === 'created' && c.objectType?.includes('PaymentRegistry')
    );
    if (registry) {
      const id = (registry as any).objectId;
      console.log('\n🎯 PaymentRegistry ID:', id);
      console.log(`\nAdd to app/.env:\nNEXT_PUBLIC_PAYMENT_REGISTRY_ID=${id}`);
    } else {
      console.log('\nAll object changes:');
      console.dir(result.objectChanges, { depth: null });
    }
  } else {
    console.error('❌ Transaction failed:', result.effects?.status);
    console.dir(result, { depth: null });
  }
}

main().catch(console.error);
