import { privateKeyToAccount } from 'viem/accounts';
import { ArcAgent, ArcExecutionError } from './arc-sdk';

async function main() {
  const net = process.env.ARC_NETWORK ?? 'mainnet';
  if (net !== 'mainnet' && net !== 'testnet') throw new Error('Invalid ARC_NETWORK');
  const key = process.env.ARC_AGENT_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Configure dedicated ARC_AGENT_PRIVATE_KEY securely');
  const agent = new ArcAgent(privateKeyToAccount(key as `0x${string}`), process.env.ARC_VAULT_ADDRESS ?? '', net, process.env.ARC_RPC_URL);
  if (!process.argv.includes('--execute')) {
    console.log(JSON.stringify(await agent.state(), (_, v) => typeof v === 'bigint' ? String(v) : v, 2));
    return;
  }
  if (net === 'mainnet' && process.env.ARC_MAINNET_CONFIRM !== 'I_CONFIRM_MAINNET_SPEND') throw new Error('Separate mainnet spend confirmation required');
  const recipient = process.env.ARC_PAYMENT_RECIPIENT ?? '';
  const amount = process.env.ARC_PAYMENT_USDC ?? '';
  const id = process.env.ARC_PAYMENT_ID ?? '';
  console.log(JSON.stringify(await agent.pay(recipient, amount, id as `0x${string}`), null, 2));
}
main().catch(error => {
  console.error(JSON.stringify(error instanceof ArcExecutionError ? { ok: false, hash: error.hash, status: error.status, error: error.message } : { ok: false, status: 'rejected', error: 'Check signer, network, capability and request. No automatic retry.' }));
  process.exitCode = 1;
});
