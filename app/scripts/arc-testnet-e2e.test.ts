// Full Arc testnet end-to-end suite. Every run uses a fresh owner/agent/vault, funded from the
// dedicated testnet owner in .env.arc-testnet. Run: pnpm arc:testnet:e2e
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, erc20Abi, keccak256, toHex, parseEther, parseEventLogs, BaseError, ContractFunctionRevertedError, type Account } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import deployment from '../src/lib/arc/testnet-deployment.json';
import { arcTestnet, USDC } from '../src/lib/arc/config';
import { vaultAbi, factoryAbi } from '../src/lib/arc/abi';
import { toCapability } from '../src/lib/arc/capability';
import { ArcAgent } from '../agent/arc-sdk';

const FACTORY = deployment.factory as `0x${string}`;
const rpc = http(arcTestnet.rpcUrls.default.http[0], { retryCount: 2 });
const p = createPublicClient({ chain: arcTestnet, transport: rpc });
const funderKey = process.env.ARC_OWNER_PRIVATE_KEY;
const funder = funderKey && /^0x[0-9a-fA-F]{64}$/.test(funderKey) ? privateKeyToAccount(funderKey as `0x${string}`) : undefined;
const owner = privateKeyToAccount(generatePrivateKey());
const agent = privateKeyToAccount(generatePrivateKey());
const outsider = privateKeyToAccount(generatePrivateKey()).address;
const ownerWallet = createWalletClient({ account: owner, chain: arcTestnet, transport: rpc });
const txs: Record<string, string> = {};
let vault: `0x${string}`;
const id = (label: string) => keccak256(toHex(`e2e-${Date.now()}-${label}`));

async function send(label: string, hash: `0x${string}`) {
  txs[label] = hash;
  const receipt = await p.waitForTransactionReceipt({ hash, timeout: 90_000 });
  assert.equal(receipt.status, 'success', `${label} reverted`);
  return receipt;
}
async function ownerCall(label: string, address: `0x${string}`, abi: any, functionName: string, args: unknown[]) {
  const { request } = await p.simulateContract({ account: owner, address, abi, functionName, args } as any);
  return send(label, await ownerWallet.writeContract(request as any));
}
async function revertName(account: Account, recipient: `0x${string}`, amount: bigint, paymentId: `0x${string}`) {
  try { await p.simulateContract({ account, address: vault, abi: vaultAbi, functionName: 'pay', args: [recipient, amount, paymentId] }); return 'NO_REVERT'; }
  catch (e) { const r = e instanceof BaseError ? e.walk(x => x instanceof ContractFunctionRevertedError) : undefined; return r instanceof ContractFunctionRevertedError ? r.data?.errorName : 'UNKNOWN'; }
}
const cap = async () => toCapability(await p.readContract({ address: vault, abi: vaultAbi, functionName: 'capabilities', args: [agent.address] }));
const authorize = async (label: string, maxTotal: bigint, maxPayment: bigint, ttl: bigint, list: `0x${string}`[], extra: { maxPerDay?: bigint; gasAllowance?: bigint; useRegistry?: boolean } = {}) =>
  ownerCall(label, vault, vaultAbi, 'authorize', [agent.address, { maxTotal, maxPayment, maxPerDay: extra.maxPerDay ?? maxTotal, gasAllowance: extra.gasAllowance ?? 0n, expiresAt: (await p.getBlock()).timestamp + ttl, useRegistry: extra.useRegistry ?? false }, list]);

test('Arc testnet end-to-end', { timeout: 600_000 }, async t => {
  assert.ok(funder, 'ARC_OWNER_PRIVATE_KEY missing: run pnpm arc:testnet:setup and fund via faucet');

  await t.test('network is Arc testnet with 6-decimal USDC', async () => {
    assert.equal(await p.getChainId(), 5042002);
    assert.equal(await p.readContract({ address: USDC, abi: erc20Abi, functionName: 'decimals' }), 6);
    assert.equal((await p.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'usdc' })).toLowerCase(), USDC.toLowerCase());
  });

  await t.test('fund fresh owner and agent with gas', async () => {
    const w = createWalletClient({ account: funder!, chain: arcTestnet, transport: rpc });
    await send('fundOwner', await w.sendTransaction({ to: owner.address, value: parseEther('0.3') }));
    await send('fundAgent', await w.sendTransaction({ to: agent.address, value: parseEther('0.05') }));
    assert.ok(await p.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [owner.address] }) >= 200_000n);
  });

  await t.test('factory creates vaults and lists them per owner', async () => {
    const receipt = await ownerCall('createVault', FACTORY, factoryAbi, 'createVault', []);
    const [ev] = parseEventLogs({ abi: factoryAbi, eventName: 'VaultCreated', logs: receipt.logs });
    vault = ev.args.vault;
    assert.equal(await p.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'vaultOf', args: [owner.address] }), vault);
    assert.deepEqual(await p.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'vaultsOf', args: [owner.address] }), [vault]);
    assert.equal((await p.readContract({ address: vault, abi: vaultAbi, functionName: 'owner' })).toLowerCase(), owner.address.toLowerCase());
  });

  await t.test('owner approves and deposits 0.1 USDC', async () => {
    await ownerCall('approve', USDC, erc20Abi, 'approve', [vault, 100_000n]);
    await ownerCall('deposit', vault, vaultAbi, 'deposit', [100_000n]);
    assert.equal(await p.readContract({ address: vault, abi: vaultAbi, functionName: 'balance' }), 100_000n);
  });

  await t.test('only the owner can authorize, withdraw and revoke', async () => {
    const e = (fn: string, args: unknown[]) => p.simulateContract({ account: agent, address: vault, abi: vaultAbi, functionName: fn, args } as any);
    await assert.rejects(e('authorize', [agent.address, { maxTotal: 1n, maxPayment: 1n, maxPerDay: 1n, gasAllowance: 0n, expiresAt: 9_999_999_999n, useRegistry: false }, [outsider]]), /NotOwner/);
    await assert.rejects(e('setRecipient', [agent.address, outsider, true]), /NotOwner/);
    await assert.rejects(e('setRegistry', [outsider]), /NotOwner/);
    await assert.rejects(e('withdraw', [1n]), /NotOwner/);
    await assert.rejects(e('revoke', [agent.address]), /NotOwner/);
  });

  await t.test('unauthorized agent cannot pay', async () => {
    assert.equal(await revertName(agent, owner.address, 1n, id('pre')), 'Unauthorized');
  });

  await t.test('owner authorizes agent: 0.03 total, 0.02 per payment, 1h, owner-only recipient', async () => {
    await authorize('authorize', 30_000n, 20_000n, 3600n, [owner.address]);
    const c = await cap();
    assert.deepEqual([c.maxTotal, c.maxPayment, c.spent, c.active], [30_000n, 20_000n, 0n, true]);
    assert.equal(await p.readContract({ address: vault, abi: vaultAbi, functionName: 'allowed', args: [agent.address, owner.address] }), true);
  });

  await t.test('policy rejections: limit, recipient, caller', async () => {
    assert.equal(await revertName(agent, owner.address, 20_001n, id('lim')), 'PaymentLimit');
    assert.equal(await revertName(agent, outsider, 1n, id('rcpt')), 'RecipientDenied');
    assert.equal(await revertName(owner, owner.address, 1n, id('caller')), 'Unauthorized');
  });

  const paymentId = id('valid');
  await t.test('agent SDK pays 0.02 USDC and emits Paid', async () => {
    const before = await p.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [owner.address] });
    const r = await new ArcAgent(agent, vault, 'testnet').pay(owner.address, '0.02', paymentId);
    txs.pay = r.hash;
    const receipt = await p.getTransactionReceipt({ hash: r.hash });
    const [ev] = parseEventLogs({ abi: vaultAbi, eventName: 'Paid', logs: receipt.logs });
    assert.equal(ev.args.amount, 20_000n);
    assert.equal(ev.args.remainingBudget, 10_000n);
    assert.equal(await p.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [owner.address] }) - before >= 20_000n - 10n ** 5n, true);
    assert.equal(await p.readContract({ address: vault, abi: vaultAbi, functionName: 'balance' }), 80_000n);
    assert.equal(await p.readContract({ address: vault, abi: vaultAbi, functionName: 'usedPaymentIds', args: [agent.address, paymentId] }), true);
  });

  await t.test('duplicate payment ID and lifetime budget are enforced', async () => {
    assert.equal(await revertName(agent, owner.address, 1n, paymentId), 'DuplicatePayment');
    assert.equal(await revertName(agent, owner.address, 10_001n, id('total')), 'TotalLimit');
  });

  await t.test('daily limit, gas allowance, single-recipient edits and merchant registry', async () => {
    await authorize('authorizeV2', 80_000n, 20_000n, 3600n, [owner.address], { maxPerDay: 30_000n, gasAllowance: 5_000n });
    const left = await p.readContract({ address: vault, abi: vaultAbi, functionName: 'dailyRemaining', args: [agent.address] });
    assert.equal(await revertName(agent, owner.address, left + 1n, id('day')), left + 1n > 20_000n ? 'PaymentLimit' : 'DailyLimit');
    const g = createWalletClient({ account: agent, chain: arcTestnet, transport: rpc });
    const top = await p.simulateContract({ account: agent, address: vault, abi: vaultAbi, functionName: 'topUpGas', args: [5_000n] });
    await send('topUpGas', await g.writeContract(top.request));
    await assert.rejects(p.simulateContract({ account: agent, address: vault, abi: vaultAbi, functionName: 'topUpGas', args: [1n] }), /GasLimit/);
    assert.equal((await cap()).gasSpent, 5_000n);
    assert.equal(await revertName(agent, outsider, 1n, id('one')), 'RecipientDenied');
    await ownerCall('setRecipient', vault, vaultAbi, 'setRecipient', [agent.address, outsider, true]);
    assert.equal(await revertName(agent, outsider, 1n, id('one')), 'NO_REVERT');
    await ownerCall('removeRecipient', vault, vaultAbi, 'setRecipient', [agent.address, outsider, false]);
    assert.equal(await revertName(agent, outsider, 1n, id('one')), 'RecipientDenied');
    const merchant = deployment.merchant as `0x${string}`;
    await ownerCall('setRegistry', vault, vaultAbi, 'setRegistry', [deployment.registry]);
    assert.equal(await revertName(agent, merchant, 1n, id('m')), 'RecipientDenied');
    await authorize('authorizeRegistry', 80_000n, 20_000n, 3600n, [owner.address], { maxPerDay: 30_000n, gasAllowance: 5_000n, useRegistry: true });
    assert.equal(await revertName(agent, merchant, 1n, id('m')), 'NO_REVERT');
  });

  await t.test('capability expires on-chain', async () => {
    await authorize('reauthorizeShort', 50_000n, 20_000n, 20n, [owner.address]);
    const { expiresAt } = await cap();
    for (let i = 0; i < 90 && (await p.getBlock()).timestamp < expiresAt; i++) await new Promise(r => setTimeout(r, 1000));
    assert.equal(await revertName(agent, owner.address, 1n, id('exp')), 'Expired');
  });

  await t.test('revocation stops payments immediately', async () => {
    await authorize('reauthorize', 50_000n, 20_000n, 3600n, [owner.address]);
    assert.equal(await revertName(agent, owner.address, 1n, id('ok')), 'NO_REVERT');
    await ownerCall('revoke', vault, vaultAbi, 'revoke', [agent.address]);
    assert.equal((await cap()).active, false);
    assert.equal(await revertName(agent, owner.address, 1n, id('rev')), 'Unauthorized');
  });

  await t.test('owner withdraws remaining funds', async () => {
    const rest = await p.readContract({ address: vault, abi: vaultAbi, functionName: 'balance' });
    assert.equal(rest, 75_000n);
    await assert.rejects(p.simulateContract({ account: owner, address: vault, abi: vaultAbi, functionName: 'withdraw', args: [rest + 1n] }));
    await ownerCall('withdraw', vault, vaultAbi, 'withdraw', [rest]);
    assert.equal(await p.readContract({ address: vault, abi: vaultAbi, functionName: 'balance' }), 0n);
  });

  writeFileSync('../contracts/arc/deployments/5042002-e2e.json', JSON.stringify({ chainId: 5042002, factory: FACTORY, vault, owner: owner.address, agent: agent.address, transactions: txs, status: 'PASS', testedAt: new Date().toISOString() }, null, 2));
  // Publish the latest receipts to the app's security page.
  const dep = JSON.parse(readFileSync('src/lib/arc/testnet-deployment.json', 'utf8'));
  writeFileSync('src/lib/arc/testnet-deployment.json', JSON.stringify({ ...dep, paymentHash: txs.pay, e2e: { vault, transactions: txs, testedAt: new Date().toISOString() } }, null, 2) + '\n');
});
