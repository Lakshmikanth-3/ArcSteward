import { test } from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom, defineChain, keccak256, toHex, encodeFunctionData, decodeEventLog, decodeErrorResult } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { artifacts } from './arc-compile.mjs';

test('Arc vault: complete flow and enforcement on a local EVM (not Arc evidence)', async t => {
  const provider = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337 }, wallet: { totalAccounts: 4 } });
  const accounts = Object.values(provider.getInitialAccounts()).map(a => privateKeyToAccount(a.secretKey));
  const chain = defineChain({ id: 31337, name: 'Local EVM', nativeCurrency: { name: 'Local', symbol: 'LOCAL', decimals: 18 }, rpcUrls: { default: { http: ['http://localhost'] } } });
  const publicClient = createPublicClient({ chain, transport: custom(provider) });
  const wallets = accounts.map(account => createWalletClient({ account, chain, transport: custom(provider) }));
  const [owner, agent, recipient, outsider] = accounts;
  const deploy = async (name, args = []) => {
    const hash = await wallets[0].deployContract({ ...artifacts[name], args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success');
    return receipt.contractAddress;
  };
  const token = await deploy('TestToken');
  const factory = await deploy('ArcVaultFactory', [token]);
  const read = (target, name, fn, args = []) => publicClient.readContract({ address: target, abi: artifacts[name].abi, functionName: fn, args });
  const write = async (wallet, target, name, fn, args = []) => {
    const { request } = await publicClient.simulateContract({ account: wallet.account, address: target, abi: artifacts[name].abi, functionName: fn, args });
    const hash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success');
    return receipt;
  };
  const deny = async (wallet, target, name, fn, args, errorName) => {
    // Ganache's custom provider exposes revert bytes on error.data rather than
    // the JSON-RPC wrapper viem expects. Decode the raw revert to assert the reason.
    await assert.rejects(provider.request({ method: 'eth_call', params: [{ from: wallet.account.address, to: target, data: encodeFunctionData({ abi: artifacts[name].abi, functionName: fn, args }) }, 'latest'] }), error => {
      if (errorName) assert.equal(decodeErrorResult({ abi: [...artifacts[name].abi, ...artifacts.ArcVault.abi], data: error.data }).errorName, errorName);
      return true;
    });
  };
  let vault;
  const id = n => keccak256(toHex(String(n)));
  const authorize = (maxTotal = 10_000_000n, maxPayment = 3_000_000n, list = [recipient.address], expires = BigInt(Math.floor(Date.now() / 1000) + 3600)) => write(wallets[0], vault, 'ArcVault', 'authorize', [agent.address, maxTotal, maxPayment, expires, list]);
  try {
    await t.test('create vault, prohibit duplicate creation, approve and deposit', async () => {
      await write(wallets[0], factory, 'ArcVaultFactory', 'createVault');
      vault = await read(factory, 'ArcVaultFactory', 'vaultOf', [owner.address]);
      assert.equal((await read(vault, 'ArcVault', 'owner')).toLowerCase(), owner.address.toLowerCase());
      await deny(wallets[0], factory, 'ArcVaultFactory', 'createVault', [], 'InvalidInput');
      await write(wallets[0], token, 'TestToken', 'mint', [owner.address, 20_000_000n]);
      await write(wallets[0], token, 'TestToken', 'approve', [vault, 20_000_000n]);
      await write(wallets[0], vault, 'ArcVault', 'deposit', [12_000_000n]);
      assert.equal(await read(vault, 'ArcVault', 'balance'), 12_000_000n);
    });
    await t.test('valid agent payment emits receipt, consumes budget and rejects duplicate', async () => {
      await authorize();
      const receipt = await write(wallets[1], vault, 'ArcVault', 'pay', [recipient.address, 3_000_000n, id(1)]);
      const paid = receipt.logs.filter(l => l.address.toLowerCase() === vault.toLowerCase()).map(l => decodeEventLog({ abi: artifacts.ArcVault.abi, ...l })).find(e => e.eventName === 'Paid');
      assert.equal(paid.args.remainingBudget, 7_000_000n);
      assert.equal(await read(token, 'TestToken', 'balanceOf', [recipient.address]), 3_000_000n);
      await deny(wallets[1], vault, 'ArcVault', 'pay', [recipient.address, 1n, id(1)], 'DuplicatePayment');
    });
    await t.test('allowlist, transaction limit, cumulative limit, unauthorized and zero input', async () => {
      await deny(wallets[1], vault, 'ArcVault', 'pay', [outsider.address, 1n, id(2)], 'RecipientDenied');
      await deny(wallets[1], vault, 'ArcVault', 'pay', [recipient.address, 3_000_001n, id(2)], 'PaymentLimit');
      await deny(wallets[3], vault, 'ArcVault', 'pay', [recipient.address, 1n, id(2)], 'Unauthorized');
      await deny(wallets[1], vault, 'ArcVault', 'pay', [recipient.address, 0n, id(2)], 'InvalidInput');
      await write(wallets[1], vault, 'ArcVault', 'pay', [recipient.address, 3_000_000n, id(2)]);
      await write(wallets[1], vault, 'ArcVault', 'pay', [recipient.address, 3_000_000n, id(3)]);
      await deny(wallets[1], vault, 'ArcVault', 'pay', [recipient.address, 2_000_000n, id(4)], 'TotalLimit');
    });
    await t.test('updates preserve spend and invalidate prior recipients; revoke fails closed', async () => {
      await authorize(10_000_000n, 3_000_000n, [outsider.address]);
      assert.equal((await read(vault, 'ArcVault', 'capabilities', [agent.address]))[2], 9_000_000n);
      await deny(wallets[1], vault, 'ArcVault', 'pay', [recipient.address, 1n, id(5)], 'RecipientDenied');
      await write(wallets[0], vault, 'ArcVault', 'revoke', [agent.address]);
      await deny(wallets[1], vault, 'ArcVault', 'pay', [outsider.address, 1n, id(5)], 'Unauthorized');
      await deny(wallets[0], vault, 'ArcVault', 'authorize', [agent.address, 1n, 1n, 9999999999n, [recipient.address]], 'InvalidInput');
    });
    await t.test('withdrawals, insufficient funds, token failure rolls back accounting', async () => {
      await authorize(20_000_000n, 5_000_000n);
      await deny(wallets[1], vault, 'ArcVault', 'withdraw', [1n], 'NotOwner');
      await deny(wallets[3], vault, 'ArcVault', 'revoke', [agent.address], 'NotOwner');
      await deny(wallets[3], vault, 'ArcVault', 'deposit', [1n], 'NotOwner');
      await deny(wallets[3], vault, 'ArcVault', 'authorize', [agent.address, 1n, 1n, 9999999999n, [recipient.address]], 'NotOwner');
      await deny(wallets[0], vault, 'ArcVault', 'withdraw', [4_000_000n], 'InsufficientFunds');
      await deny(wallets[1], vault, 'ArcVault', 'pay', [recipient.address, 4_000_000n, id(6)], 'InsufficientFunds');
      await write(wallets[0], token, 'TestToken', 'setFail', [true]);
      await deny(wallets[1], vault, 'ArcVault', 'pay', [recipient.address, 1n, id(6)]);
      // Broadcast a reverting transaction as well as simulating it.
      const hash = await wallets[1].writeContract({ address: vault, abi: artifacts.ArcVault.abi, functionName: 'pay', args: [recipient.address, 1n, id(6)], gas: 250000n });
      assert.equal((await publicClient.waitForTransactionReceipt({ hash })).status, 'reverted');
      assert.equal(await read(vault, 'ArcVault', 'usedPaymentIds', [agent.address, id(6)]), false);
      assert.equal((await read(vault, 'ArcVault', 'capabilities', [agent.address]))[2], 9_000_000n);
      await write(wallets[0], token, 'TestToken', 'setFail', [false]);
    });
    await t.test('malicious token callback cannot reenter pay or withdrawal', async () => {
      await write(wallets[0], vault, 'ArcVault', 'authorize', [token, 100n, 100n, 9999999999n, [recipient.address]]);
      await write(wallets[0], token, 'TestToken', 'setCallback', [vault, encodeFunctionData({ abi: artifacts.ArcVault.abi, functionName: 'pay', args: [recipient.address, 1n, id('reentry')] })]);
      await write(wallets[1], vault, 'ArcVault', 'pay', [recipient.address, 1n, id(7)]);
      assert.equal(await read(token, 'TestToken', 'reentrySucceeded'), false);
      assert.equal((await read(vault, 'ArcVault', 'capabilities', [token]))[2], 0n);
      await write(wallets[0], token, 'TestToken', 'setCallback', [vault, encodeFunctionData({ abi: artifacts.ArcVault.abi, functionName: 'withdraw', args: [1n] })]);
      await write(wallets[0], vault, 'ArcVault', 'withdraw', [1n]);
      assert.equal(await read(token, 'TestToken', 'reentrySucceeded'), false);
    });
    await t.test('expires at exact boundary and invalid authorizations rejected', async () => {
      const now = (await publicClient.getBlock()).timestamp;
      await authorize(20_000_000n, 5_000_000n, [recipient.address], now + 10n);
      await provider.request({ method: 'evm_increaseTime', params: [11] });
      await provider.request({ method: 'evm_mine', params: [] });
      await deny(wallets[1], vault, 'ArcVault', 'pay', [recipient.address, 1n, id(8)], 'Expired');
      await deny(wallets[0], vault, 'ArcVault', 'authorize', [agent.address, 20_000_000n, 1n, 9999999999n, []], 'InvalidInput');
      await deny(wallets[0], vault, 'ArcVault', 'authorize', [owner.address, 20_000_000n, 1n, 9999999999n, [recipient.address]], 'InvalidInput');
    });
  } finally { await provider.disconnect(); }
});
