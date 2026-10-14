import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, erc20Abi, keccak256, toHex, BaseError, ContractFunctionRevertedError } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet, USDC } from '../src/lib/arc/config';
import { vaultAbi } from '../src/lib/arc/abi';
import { ArcAgent } from '../agent/arc-sdk';

async function main() {
  if (process.env.ARC_NETWORK !== 'testnet') throw new Error('Testnet-only enforcement test');
  const key = (name: string) => { const value = process.env[name]; if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('Missing dedicated test signer'); return privateKeyToAccount(value as `0x${string}`); };
  const owner = key('ARC_OWNER_PRIVATE_KEY');
  const agent = key('ARC_AGENT_PRIVATE_KEY');
  const smoke = JSON.parse(readFileSync('../contracts/arc/deployments/5042002-smoke.json', 'utf8')) as { vault: `0x${string}`; factory: `0x${string}` };
  const p = createPublicClient({ chain: arcTestnet, transport: http(arcTestnet.rpcUrls.default.http[0], { retryCount: 0 }) });
  if (await p.getChainId() !== arcTestnet.id) throw new Error('Chain mismatch');
  if ((await p.readContract({ address: smoke.vault, abi: vaultAbi, functionName: 'owner' })).toLowerCase() !== owner.address.toLowerCase()) throw new Error('Vault owner mismatch');
  const wallet = createWalletClient({ account: owner, chain: arcTestnet, transport: http(arcTestnet.rpcUrls.default.http[0], { retryCount: 0 }) });
  const results: { name: string; result: string }[] = [];
  const transactions: string[] = [];
  const reportPath = '../contracts/arc/deployments/5042002-enforcement.json';
  const save = (status: string) => writeFileSync(reportPath, JSON.stringify({ chainId: arcTestnet.id, vault: smoke.vault, status, results, transactions, updatedAt: new Date().toISOString() }, null, 2));
  async function confirmed(hash: `0x${string}`) { transactions.push(hash); console.log(`Submitted testnet enforcement transaction: ${hash}`); save('running'); if ((await p.waitForTransactionReceipt({ hash, timeout: 90000 })).status !== 'success') throw new Error('Test transaction reverted'); }
  async function rejected(name: string, account: typeof owner, recipient: `0x${string}`, amount: bigint, id: `0x${string}`, expected: string) {
    let reason: string | undefined;
    try { await p.simulateContract({ account, address: smoke.vault, abi: vaultAbi, functionName: 'pay', args: [recipient, amount, id] }); }
    catch (error) { const revert = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : undefined; if (revert instanceof ContractFunctionRevertedError) reason = revert.data?.errorName; }
    if (reason !== expected) throw new Error(`Enforcement check failed: ${name}`);
    results.push({ name, result: `PASS: ${expected}` });
  }
  const id = (label: string) => keccak256(toHex(`testnet-enforcement-${Date.now()}-${label}`));
  if (process.argv.includes('--recover')) {
    const revoke = await p.simulateContract({ account: owner, address: smoke.vault, abi: vaultAbi, functionName: 'revoke', args: [agent.address] });
    await confirmed(await wallet.writeContract(revoke.request));
    const balance = await p.readContract({ address: smoke.vault, abi: vaultAbi, functionName: 'balance' });
    if (balance > 0n) { const withdraw = await p.simulateContract({ account: owner, address: smoke.vault, abi: vaultAbi, functionName: 'withdraw', args: [balance] }); await confirmed(await wallet.writeContract(withdraw.request)); }
    save('recovered'); console.log('Testnet capability revoked and remaining vault funds recovered to owner.'); return;
  }
  await rejected('revoked agent', agent, owner.address, 1n, id('revoked'), 'Unauthorized');
  if (!process.argv.includes('--execute')) { console.log(JSON.stringify({ readOnly: true, results }, null, 2)); return; }
  const initial = await p.readContract({ address: smoke.vault, abi: vaultAbi, functionName: 'capabilities', args: [agent.address] });
  const ceiling = initial[2] + 10000n;
  const authorize = async (expiry: bigint) => { const { request } = await p.simulateContract({ account: owner, address: smoke.vault, abi: vaultAbi, functionName: 'authorize', args: [agent.address, ceiling, 10000n, expiry, [owner.address]] }); await confirmed(await wallet.writeContract(request)); };
  await authorize((await p.getBlock()).timestamp + 3600n);
  const approve = await p.simulateContract({ account: owner, address: USDC, abi: erc20Abi, functionName: 'approve', args: [smoke.vault, 20000n] });
  await confirmed(await wallet.writeContract(approve.request));
  const deposit = await p.simulateContract({ account: owner, address: smoke.vault, abi: vaultAbi, functionName: 'deposit', args: [20000n] });
  await confirmed(await wallet.writeContract(deposit.request));
  await rejected('per-payment ceiling', agent, owner.address, 10001n, id('payment-limit'), 'PaymentLimit');
  await rejected('recipient allowlist', agent, smoke.factory, 1n, id('recipient'), 'RecipientDenied');
  await rejected('unauthorized caller', owner, owner.address, 1n, id('caller'), 'Unauthorized');
  const paymentId = id('valid');
  const payment = await new ArcAgent(agent, smoke.vault, 'testnet').pay(owner.address, '0.01', paymentId);
  transactions.push(payment.hash);
  console.log(`Testnet enforcement payment: ${payment.hash}`); save('running');
  await rejected('duplicate payment ID', agent, owner.address, 1n, paymentId, 'DuplicatePayment');
  await rejected('exhausted lifetime budget', agent, owner.address, 1n, id('total'), 'TotalLimit');
  const expiry = (await p.getBlock()).timestamp + 30n;
  await authorize(expiry);
  let expired = false;
  for (let i = 0; i < 90; i++) { if ((await p.getBlock()).timestamp >= expiry) { expired = true; break; } await new Promise(resolve => setTimeout(resolve, 1000)); }
  if (!expired) throw new Error('Wait for on-chain expiry and reconcile');
  await rejected('expired capability', agent, owner.address, 1n, id('expiry'), 'Expired');
  const revoke = await p.simulateContract({ account: owner, address: smoke.vault, abi: vaultAbi, functionName: 'revoke', args: [agent.address] });
  await confirmed(await wallet.writeContract(revoke.request));
  await rejected('revocation after reauthorization', agent, owner.address, 1n, id('final'), 'Unauthorized');
  const balance = await p.readContract({ address: smoke.vault, abi: vaultAbi, functionName: 'balance' });
  if (balance > 0n) { const withdraw = await p.simulateContract({ account: owner, address: smoke.vault, abi: vaultAbi, functionName: 'withdraw', args: [balance] }); await confirmed(await wallet.writeContract(withdraw.request)); }
  writeFileSync(reportPath, JSON.stringify({ chainId: arcTestnet.id, vault: smoke.vault, status: 'PASS', results, transactions, payment, testedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ chainId: arcTestnet.id, results, status: 'PASS', note: 'Actual testnet transactions and rejected simulations; no mainnet eligibility claim.' }, null, 2));
}
main().catch(error => { console.error(error instanceof Error && !/0x[0-9a-fA-F]{64}/.test(error.message) ? error.message : 'Testnet enforcement stopped; reconcile hashes and revoke any active capability.'); process.exitCode = 1; });
