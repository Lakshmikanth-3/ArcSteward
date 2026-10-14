import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createPublicClient, createWalletClient, http, erc20Abi, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet, USDC } from '../src/lib/arc/config';
import { factoryAbi } from '../src/lib/arc/abi';

async function main() {
  if (process.env.ARC_NETWORK !== 'testnet') throw new Error('This runner supports Arc TESTNET only');
  const ownerKey = process.env.ARC_OWNER_PRIVATE_KEY;
  const agentKey = process.env.ARC_AGENT_PRIVATE_KEY;
  if (!ownerKey || !agentKey || !/^0x[0-9a-fA-F]{64}$/.test(ownerKey) || !/^0x[0-9a-fA-F]{64}$/.test(agentKey)) throw new Error('Configure dedicated testnet signers');
  const owner = privateKeyToAccount(ownerKey as `0x${string}`);
  const agent = privateKeyToAccount(agentKey as `0x${string}`);
  if (owner.address === agent.address) throw new Error('Signers must differ');
  const transport = http(arcTestnet.rpcUrls.default.http[0], { retryCount: 0, timeout: 15000 });
  const p = createPublicClient({ chain: arcTestnet, transport });
  if (await p.getChainId() !== arcTestnet.id) throw new Error('Testnet chain mismatch');
  if (await p.readContract({ address: USDC, abi: erc20Abi, functionName: 'decimals' }) !== 6) throw new Error('Unexpected token decimals');
  const [ownerBalance, agentBalance] = await Promise.all([p.getBalance({ address: owner.address }), p.getBalance({ address: agent.address })]);
  console.log(JSON.stringify({ network: 'Arc Testnet', chainId: arcTestnet.id, owner: owner.address, agent: agent.address, ownerUSDC: formatUnits(ownerBalance, 18), agentUSDC: formatUnits(agentBalance, 18), execute: false }, null, 2));
  if (ownerBalance < 2n * 10n ** 18n) throw new Error('Fund the owner with free faucet USDC before executing');
  if (!process.argv.includes('--execute')) return;
  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve('tsx/cli');
  const env = { ...process.env, ARC_NETWORK: 'testnet', ARC_RPC_URL: arcTestnet.rpcUrls.default.http[0], ARC_MAINNET_CONFIRM: '' };
  const manifestPath = '../contracts/arc/deployments/5042002.json';
  if (!existsSync(manifestPath)) execFileSync(process.execPath, [tsxCli, 'scripts/arc-deploy.ts', '--broadcast'], { env, stdio: 'inherit', windowsHide: true });
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { chainId: number; status: string; factory: `0x${string}`; deploymentHash: `0x${string}` };
  if (manifest.chainId !== arcTestnet.id || manifest.status !== 'confirmed') throw new Error('Reconcile pending testnet deployment before continuing');
  if ((await p.getTransactionReceipt({ hash: manifest.deploymentHash })).status !== 'success') throw new Error('Deployment receipt failed');
  if ((await p.readContract({ address: manifest.factory, abi: factoryAbi, functionName: 'usdc' })).toLowerCase() !== USDC.toLowerCase()) throw new Error('Factory token mismatch');
  // Fund only the dedicated testnet agent; 1 USDC is a gas reserve, not a vault deposit.
  if (agentBalance < 10n ** 18n) {
    const wallet = createWalletClient({ account: owner, chain: arcTestnet, transport });
    const { request } = await p.simulateContract({ account: owner, address: USDC, abi: erc20Abi, functionName: 'transfer', args: [agent.address, 1_000_000n] });
    const hash = await wallet.writeContract(request);
    console.log(`Testnet agent funding submitted: ${hash}`);
    if ((await p.waitForTransactionReceipt({ hash, timeout: 90000 })).status !== 'success') throw new Error('Agent funding failed');
  }
  const smokePath = '../contracts/arc/deployments/5042002-smoke.json';
  if (!existsSync(smokePath)) execFileSync(process.execPath, [tsxCli, 'scripts/arc-smoke.ts', '--execute'], { env: { ...env, ARC_FACTORY_ADDRESS: manifest.factory }, stdio: 'inherit', windowsHide: true });
  const smoke = JSON.parse(readFileSync(smokePath, 'utf8')) as { chainId: number; vault: string; agent: string; payment: { hash: string }; revokedPaymentSimulationRejected: boolean };
  if (smoke.chainId !== arcTestnet.id || !smoke.revokedPaymentSimulationRejected) throw new Error('Smoke proof is incomplete');
  writeFileSync('../docs/arc-testnet-evidence.json', JSON.stringify({ chainId: arcTestnet.id, factory: manifest.factory, vault: smoke.vault, agent: smoke.agent, deploymentHash: manifest.deploymentHash, paymentHash: smoke.payment.hash, browserUrl: 'http://localhost:3000/testnet', mainnetEligible: false }, null, 2));
  console.log('Testnet deployment/payment complete. Open /testnet, enter the factory, vault and agent addresses from public evidence, refresh state and inspect actual events. This does not satisfy mainnet eligibility.');
}
main().catch(error => { console.error(error instanceof Error && !/0x[0-9a-fA-F]{64}/.test(error.message) ? error.message : 'Testnet runner stopped; reconcile any submitted hash before retrying.'); process.exitCode = 1; });
