// One-time testnet setup for the live x402 + AI agent demo:
//   merchant address (receives x402 payments), registered in the merchant registry,
//   a vault owned by the testnet owner, funded, with the testnet agent authorized for the merchant via the registry.
// Writes public addresses to src/lib/arc/testnet-deployment.json. Keys stay in ignored .env.arc-testnet.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, erc20Abi, parseEther, parseEventLogs, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arcTestnet, USDC } from '../src/lib/arc/config';
import { vaultAbi, factoryAbi, registryAbi } from '../src/lib/arc/abi';

const rpc = http(arcTestnet.rpcUrls.default.http[0], { retryCount: 2 });
const p = createPublicClient({ chain: arcTestnet, transport: rpc });
const dep = JSON.parse(readFileSync('../contracts/arc/deployments/5042002.json', 'utf8')) as { factory: `0x${string}`; registry: `0x${string}`; deploymentHash: string };
const deployer = privateKeyToAccount(process.env.ARC_DEPLOYER_PRIVATE_KEY as Hex);
const owner = privateKeyToAccount(process.env.ARC_OWNER_PRIVATE_KEY as Hex);
const agent = privateKeyToAccount(process.env.ARC_AGENT_PRIVATE_KEY as Hex);
let merchantKey = process.env.ARC_MERCHANT_PRIVATE_KEY as Hex | undefined;
if (!merchantKey) { merchantKey = generatePrivateKey(); appendFileSync('.env.arc-testnet', `\nARC_MERCHANT_PRIVATE_KEY=${merchantKey}\n`); }
const merchant = privateKeyToAccount(merchantKey).address;
const send = async (account: typeof owner, req: Parameters<ReturnType<typeof createWalletClient>['writeContract']>[0]) => {
  const w = createWalletClient({ account, chain: arcTestnet, transport: rpc });
  const { request } = await p.simulateContract({ ...(req as object), account } as never);
  const hash = await w.writeContract(request as never);
  const r = await p.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`reverted ${hash}`);
  return r;
};

async function main() {
await send(deployer, { address: dep.registry, abi: registryAbi, functionName: 'setMerchant', args: [merchant, true, 'Velo402 demo data API'] } as never);
const created = await send(owner, { address: dep.factory, abi: factoryAbi, functionName: 'createVault' } as never);
const vault = parseEventLogs({ abi: factoryAbi, eventName: 'VaultCreated', logs: created.logs })[0].args.vault;
await send(owner, { address: USDC, abi: erc20Abi, functionName: 'approve', args: [vault, 500_000n] } as never);
await send(owner, { address: vault, abi: vaultAbi, functionName: 'deposit', args: [500_000n] } as never);
await send(owner, { address: vault, abi: vaultAbi, functionName: 'setRegistry', args: [dep.registry] } as never);
const expiresAt = (await p.getBlock()).timestamp + 60n * 86400n;
await send(owner, { address: vault, abi: vaultAbi, functionName: 'authorize', args: [agent.address, { maxTotal: 400_000n, maxPayment: 20_000n, maxPerDay: 100_000n, gasAllowance: 100_000n, expiresAt, useRegistry: true }, [owner.address]] } as never);
// Small native gas float for the agent; further gas comes from its on-chain allowance.
const ow = createWalletClient({ account: owner, chain: arcTestnet, transport: rpc });
await p.waitForTransactionReceipt({ hash: await ow.sendTransaction({ to: agent.address, value: parseEther('0.02') }) });

const out = { chainId: arcTestnet.id, factory: dep.factory, registry: dep.registry, merchant, vault, owner: owner.address, agent: agent.address, deploymentHash: dep.deploymentHash, paymentHash: '' };
writeFileSync('src/lib/arc/testnet-deployment.json', JSON.stringify(out, null, 2) + '\n');
console.log(out);
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
