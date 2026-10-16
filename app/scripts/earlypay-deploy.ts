// Deploys EarlyPayLedger. Testnet by default; mainnet needs ARC_MAINNET_CONFIRM.
// Usage: tsx --env-file=.env.arc-testnet scripts/earlypay-deploy.ts [--broadcast]
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { network } from '../src/lib/arc/config';
import { ledgerAbi } from '../src/lib/arc/abi';

async function main() {
  const chain = network(process.env.ARC_NETWORK ?? 'testnet');
  if (chain.id === 5042 && process.env.ARC_MAINNET_CONFIRM !== 'I_CONFIRM_MAINNET_SPEND') throw new Error('Separate mainnet confirmation required');
  const cooldown = BigInt(process.env.EARLYPAY_COOLDOWN_SECONDS ?? (chain.id === 5042 ? '86400' : '120'));
  const transport = http(process.env.ARC_RPC_URL ?? chain.rpcUrls.default.http[0], { timeout: 20000 });
  const pub = createPublicClient({ chain, transport });
  if (await pub.getChainId() !== chain.id) throw new Error('RPC chain mismatch');
  const key = process.env.ARC_DEPLOYER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('ARC_DEPLOYER_PRIVATE_KEY missing or invalid');
  const account = privateKeyToAccount(key as `0x${string}`);
  const { bytecode } = JSON.parse(readFileSync('../contracts/arc/artifacts/EarlyPayLedger.json', 'utf8')) as { bytecode: `0x${string}` };
  const path = `../contracts/arc/deployments/${chain.id}-earlypay.json`;
  try { readFileSync(path); throw new Error(`${path} exists. Reconcile it before redeploying.`); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  console.log(JSON.stringify({ network: chain.name, chainId: chain.id, deployer: account.address, gasBalanceUSDC: formatUnits(await pub.getBalance({ address: account.address }), 18), cooldownSeconds: String(cooldown), broadcast: process.argv.includes('--broadcast') }, null, 2));
  if (!process.argv.includes('--broadcast')) return;
  const wallet = createWalletClient({ account, chain, transport });
  const hash = await wallet.deployContract({ abi: ledgerAbi, bytecode, args: [cooldown] });
  writeFileSync(path, JSON.stringify({ chainId: chain.id, contract: 'EarlyPayLedger', deploymentHash: hash, cooldownSeconds: Number(cooldown), deployer: account.address, status: 'pending', submittedAt: new Date().toISOString() }, null, 2));
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Deployment failed');
  writeFileSync(path, JSON.stringify({ chainId: chain.id, contract: 'EarlyPayLedger', ledger: receipt.contractAddress, deploymentHash: hash, block: Number(receipt.blockNumber), cooldownSeconds: Number(cooldown), deployer: account.address, compiler: '0.8.30', optimizerRuns: 200, evmVersion: 'paris', status: 'confirmed', explorer: `${chain.blockExplorers.default.url}/address/${receipt.contractAddress}` }, null, 2));
  if (chain.id === 5042002) writeFileSync('src/lib/earlypay/testnet-ledger.json', readFileSync(path, 'utf8'));
  console.log(`EarlyPayLedger: ${receipt.contractAddress}\nTx: ${chain.blockExplorers.default.url}/tx/${hash}`);
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
