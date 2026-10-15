// Mainnet bring-up after `arc:deploy`: vault for the deployer (owner), merchant in the registry,
// a dedicated agent authorized via the registry, and one real agent payment as proof.
// Spends real USDC: requires ARC_MAINNET_CONFIRM=I_CONFIRM_MAINNET_SPEND. Keys stay in ignored app/.env.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, erc20Abi, parseEther, parseEventLogs, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arcMainnet, USDC } from '../src/lib/arc/config';
import { vaultAbi, factoryAbi, registryAbi } from '../src/lib/arc/abi';
import { ArcAgent, invoiceId } from '../agent/arc-sdk';

async function main() {
  if (process.env.ARC_MAINNET_CONFIRM !== 'I_CONFIRM_MAINNET_SPEND') throw new Error('Mainnet spend confirmation required');
  const rpc = http(arcMainnet.rpcUrls.default.http[0], { retryCount: 2, timeout: 20000 });
  const p = createPublicClient({ chain: arcMainnet, transport: rpc });
  if (await p.getChainId() !== 5042) throw new Error('Not Arc mainnet');
  const dep = JSON.parse(readFileSync('../contracts/arc/deployments/5042.json', 'utf8')) as { factory: `0x${string}`; registry: `0x${string}`; deploymentHash: string };
  const key = (name: string) => { let k = process.env[name] as Hex | undefined; if (!k) { k = generatePrivateKey(); appendFileSync('.env', `${name}=${k}\n`); } return privateKeyToAccount(k); };
  const owner = privateKeyToAccount(process.env.ARC_DEPLOYER_PRIVATE_KEY as Hex);
  const agent = key('ARC_MAINNET_AGENT_PRIVATE_KEY');
  const merchant = key('ARC_MAINNET_MERCHANT_PRIVATE_KEY').address;
  const ow = createWalletClient({ account: owner, chain: arcMainnet, transport: rpc });
  const txs: Record<string, string> = {};
  const send = async (label: string, req: object) => {
    const { request } = await p.simulateContract({ ...req, account: owner } as never);
    const hash = await ow.writeContract(request as never);
    const r = await p.waitForTransactionReceipt({ hash, timeout: 120000 });
    if (r.status !== 'success') throw new Error(`${label} reverted ${hash}`);
    txs[label] = hash; console.log(label, hash);
    return r;
  };

  // Resumable: each step is skipped if its on-chain effect already exists.
  if (!await p.readContract({ address: dep.registry, abi: registryAbi, functionName: 'approved', args: [merchant] }))
    await send('registerMerchant', { address: dep.registry, abi: registryAbi, functionName: 'setMerchant', args: [merchant, true, 'Velo402 data API'] });
  let [vault] = await p.readContract({ address: dep.factory, abi: factoryAbi, functionName: 'vaultsOf', args: [owner.address] });
  if (!vault) {
    const created = await send('createVault', { address: dep.factory, abi: factoryAbi, functionName: 'createVault' });
    vault = parseEventLogs({ abi: factoryAbi, eventName: 'VaultCreated', logs: created.logs })[0].args.vault;
  }
  if (await p.readContract({ address: vault, abi: vaultAbi, functionName: 'balance' }) < 100_000n) {
    if (await p.readContract({ address: USDC, abi: erc20Abi, functionName: 'allowance', args: [owner.address, vault] }) < 100_000n)
      await send('approve', { address: USDC, abi: erc20Abi, functionName: 'approve', args: [vault, 100_000n] });
    await send('deposit', { address: vault, abi: vaultAbi, functionName: 'deposit', args: [100_000n] });
  }
  if ((await p.readContract({ address: vault, abi: vaultAbi, functionName: 'registry' })).toLowerCase() !== dep.registry.toLowerCase())
    await send('setRegistry', { address: vault, abi: vaultAbi, functionName: 'setRegistry', args: [dep.registry] });
  const expiresAt = (await p.getBlock()).timestamp + 90n * 86400n;
  await send('authorize', { address: vault, abi: vaultAbi, functionName: 'authorize', args: [agent.address, { maxTotal: 80_000n, maxPayment: 20_000n, maxPerDay: 50_000n, gasAllowance: 20_000n, expiresAt, useRegistry: true }, [owner.address]] });
  const fund = await ow.sendTransaction({ to: agent.address, value: parseEther('0.01') });
  await p.waitForTransactionReceipt({ hash: fund }); txs.fundAgentGas = fund;

  // Real agent payment through the SDK: policy checked by the contract on Arc mainnet.
  const paid = await new ArcAgent(agent, vault, 'mainnet').pay(merchant, '0.01', invoiceId({ order: 'velo402-mainnet-first-payment', at: Date.now() }));
  txs.agentPayment = paid.hash; console.log('agentPayment', paid.hash);

  const out = { chainId: 5042, factory: dep.factory, registry: dep.registry, merchant, vault, owner: owner.address, agent: agent.address, deploymentHash: dep.deploymentHash, paymentHash: paid.hash, transactions: txs, deployedAt: new Date().toISOString() };
  writeFileSync('src/lib/arc/mainnet-deployment.json', JSON.stringify(out, null, 2) + '\n');
  writeFileSync('../contracts/arc/deployments/5042-setup.json', JSON.stringify(out, null, 2) + '\n');
  console.log(out);
}
main().catch(e => { console.error(e instanceof Error ? e.message.slice(0, 400) : e); process.exitCode = 1; });
