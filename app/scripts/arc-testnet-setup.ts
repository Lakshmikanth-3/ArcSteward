import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http, formatUnits, erc20Abi } from 'viem';
import { arcTestnet, USDC } from '../src/lib/arc/config';

async function main() {
  const path = '.env.arc-testnet';
  if (process.argv.includes('--init') && !existsSync(path)) {
    const ownerKey = generatePrivateKey();
    const agentKey = generatePrivateKey();
    const owner = privateKeyToAccount(ownerKey);
    const agent = privateKeyToAccount(agentKey);
    const lines = ['# Disposable Arc TESTNET signers only. Never fund on mainnet. Never commit or share this file.', 'ARC_NETWORK=testnet', `ARC_RPC_URL=${arcTestnet.rpcUrls.default.http[0]}`, `ARC_DEPLOYER_ADDRESS=${owner.address}`, `ARC_DEPLOYER_PRIVATE_KEY=${ownerKey}`, `ARC_OWNER_PRIVATE_KEY=${ownerKey}`, `ARC_AGENT_PRIVATE_KEY=${agentKey}`, `ARC_PAYMENT_RECIPIENT=${owner.address}`, 'ARC_SMOKE_USDC=0.01', `ARC_PAYMENT_ID=velo402-testnet-${Date.now()}`, 'ARC_MAINNET_CONFIRM='];
    writeFileSync(path, lines.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    mkdirSync('../contracts/arc/deployments', { recursive: true });
    writeFileSync('../contracts/arc/deployments/testnet-wallets.json', JSON.stringify({ chainId: arcTestnet.id, owner: owner.address, agent: agent.address, recipient: owner.address, warning: 'Dedicated testnet accounts. No deployment or payment evidence yet.' }, null, 2));
  }
  if (!existsSync(path)) throw new Error('Run with --init to prepare dedicated testnet signers');
  const values = Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
  const p = createPublicClient({ chain: arcTestnet, transport: http(arcTestnet.rpcUrls.default.http[0], { retryCount: 0, timeout: 15000 }) });
  if (await p.getChainId() !== arcTestnet.id) throw new Error('Testnet chain mismatch');
  if (await p.readContract({ address: USDC, abi: erc20Abi, functionName: 'decimals' }) !== 6) throw new Error('USDC decimals mismatch');
  for (const role of ['OWNER', 'AGENT']) {
    const account = privateKeyToAccount(values[`ARC_${role}_PRIVATE_KEY`] as `0x${string}`);
    const balance = await p.getBalance({ address: account.address });
    console.log(JSON.stringify({ role, address: account.address, nativeGasUSDC: formatUnits(balance, 18), chainId: arcTestnet.id }));
  }
  console.log('Secret keys saved only in ignored .env.arc-testnet. Public addresses above can receive testnet faucet tokens.');
}
main().catch(() => { console.error('Testnet setup failed. Check configuration/RPC. No credentials were printed.'); process.exitCode = 1; });
