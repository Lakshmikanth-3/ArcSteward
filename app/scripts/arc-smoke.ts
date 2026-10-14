import { createPublicClient, createWalletClient, http, erc20Abi, keccak256, toHex, ContractFunctionRevertedError, BaseError, type Hash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { network, USDC, address, usdcAmount } from '../src/lib/arc/config';
import { factoryAbi, vaultAbi } from '../src/lib/arc/abi';
import { ArcAgent } from '../agent/arc-sdk';
import { writeFileSync } from 'node:fs';

async function main() {
  const net = process.env.ARC_NETWORK ?? 'mainnet';
  if (net !== 'mainnet' && net !== 'testnet') throw new Error('Invalid network');
  const chain = network(net);
  const transport = http(process.env.ARC_RPC_URL ?? chain.rpcUrls.default.http[0], { retryCount: 0 });
  const p = createPublicClient({ chain, transport });
  if (await p.getChainId() !== chain.id) throw new Error('RPC chain mismatch');
  const ownerKey = process.env.ARC_OWNER_PRIVATE_KEY;
  const agentKey = process.env.ARC_AGENT_PRIVATE_KEY;
  if (!ownerKey || !agentKey || !/^0x[0-9a-fA-F]{64}$/.test(ownerKey) || !/^0x[0-9a-fA-F]{64}$/.test(agentKey)) throw new Error('Secure dedicated owner and agent signers required');
  const owner = privateKeyToAccount(ownerKey as Hash);
  const agent = privateKeyToAccount(agentKey as Hash);
  if (owner.address === agent.address) throw new Error('Owner and agent must differ');
  const factory = address(process.env.ARC_FACTORY_ADDRESS ?? '');
  const recipient = address(process.env.ARC_PAYMENT_RECIPIENT ?? '');
  const amount = process.env.ARC_SMOKE_USDC ?? '';
  const idText = process.env.ARC_PAYMENT_ID;
  if (!idText) throw new Error('Set a unique ARC_PAYMENT_ID before executing');
  const units = usdcAmount(amount);
  if (units > 100000n) throw new Error('Smoke amount must be explicitly chosen and at most 0.1 USDC');
  if ((await p.readContract({ address: factory, abi: factoryAbi, functionName: 'usdc' })).toLowerCase() !== USDC.toLowerCase()) throw new Error('Factory token mismatch');
  if (await p.readContract({ address: USDC, abi: erc20Abi, functionName: 'decimals' }) !== 6) throw new Error('USDC decimals mismatch');
  const [ownerGas, agentGas, ownerUsdc] = await Promise.all([p.getBalance({ address: owner.address }), p.getBalance({ address: agent.address }), p.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [owner.address] })]);
  if (ownerGas === 0n || agentGas === 0n || ownerUsdc <= units) throw new Error('Fund both signers for gas and owner for deposit plus gas reserve');
  console.log(JSON.stringify({ chainId: chain.id, owner: owner.address, agent: agent.address, recipient, amountUSDC: amount, factory, execute: false, operations: ['create vault', 'approve', 'deposit', 'authorize', 'agent payment', 'revoke'] }, null, 2));
  if (!process.argv.includes('--execute')) return;
  if (chain.id === 5042 && process.env.ARC_MAINNET_CONFIRM !== 'I_CONFIRM_MAINNET_SPEND') throw new Error('Separate mainnet confirmation required');
  // Fresh vault only: avoid silently overriding an existing user capability.
  if (!/^0x0{40}$/i.test(await p.readContract({ address: factory, abi: factoryAbi, functionName: 'vaultOf', args: [owner.address] }))) throw new Error('Use a fresh dedicated smoke owner, or perform the run manually');
  const wallet = createWalletClient({ account: owner, chain, transport });
  const receipts: Hash[] = [];
  async function confirm(hash: Hash) { receipts.push(hash); console.log(`Submitted ${hash}`); const r = await p.waitForTransactionReceipt({ hash, timeout: 90000 }); if (r.status !== 'success') throw new Error('Smoke transaction reverted'); }
  const create = await p.simulateContract({ account: owner, address: factory, abi: factoryAbi, functionName: 'createVault' });
  await confirm(await wallet.writeContract(create.request));
  const vault = await p.readContract({ address: factory, abi: factoryAbi, functionName: 'vaultOf', args: [owner.address] });
  const approve = await p.simulateContract({ account: owner, address: USDC, abi: erc20Abi, functionName: 'approve', args: [vault, units] });
  await confirm(await wallet.writeContract(approve.request));
  const deposit = await p.simulateContract({ account: owner, address: vault, abi: vaultAbi, functionName: 'deposit', args: [units] });
  await confirm(await wallet.writeContract(deposit.request));
  const expiresAt = (await p.getBlock()).timestamp + 3600n;
  const authorize = await p.simulateContract({ account: owner, address: vault, abi: vaultAbi, functionName: 'authorize', args: [agent.address, units, units, expiresAt, [recipient]] });
  await confirm(await wallet.writeContract(authorize.request));
  const payment = await new ArcAgent(agent, vault, net, process.env.ARC_RPC_URL).pay(recipient, amount, keccak256(toHex(idText)));
  const revoke = await p.simulateContract({ account: owner, address: vault, abi: vaultAbi, functionName: 'revoke', args: [agent.address] });
  await confirm(await wallet.writeContract(revoke.request));
  // Verify on-chain authorization rejection after revocation without broadcasting a failure.
  let rejected = false;
  try { await p.simulateContract({ account: agent, address: vault, abi: vaultAbi, functionName: 'pay', args: [recipient, units, keccak256(toHex(`${idText}-revoked`))] }); } catch (error) {
    const revert = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : undefined;
    rejected = revert instanceof ContractFunctionRevertedError && revert.data?.errorName === 'Unauthorized';
  }
  if (!rejected) throw new Error('Revocation enforcement failed');
  writeFileSync(`../contracts/arc/deployments/${chain.id}-smoke.json`, JSON.stringify({ chainId: chain.id, factory, vault, owner: owner.address, agent: agent.address, recipient, payment, ownerTransactions: receipts, revokedPaymentSimulationRejected: true, testedAt: new Date().toISOString() }, null, 2));
}
main().catch(() => { console.error('Arc smoke stopped. Reconcile submitted hashes, inspect the vault and revoke any active agent using the owner wallet. No automatic retry.'); process.exitCode = 1; });
