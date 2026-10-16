import { test } from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom, defineChain, keccak256, toHex, encodeFunctionData, decodeErrorResult, decodeEventLog, zeroHash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { artifacts } from './arc-compile.mjs';

// EarlyPayLedger on a local EVM (not Arc evidence): signatures, expiry, payout
// mismatch, cooldown, recorder rights, hash-chain integrity, no fund custody.
test('EarlyPayLedger: offers, cooldown, recorder rights and hash chain', async t => {
  const provider = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337 }, wallet: { totalAccounts: 6 } });
  const accounts = Object.values(provider.getInitialAccounts()).map(a => privateKeyToAccount(a.secretKey));
  const chain = defineChain({ id: 31337, name: 'Local EVM', nativeCurrency: { name: 'Local', symbol: 'LOCAL', decimals: 18 }, rpcUrls: { default: { http: ['http://localhost'] } } });
  const pub = createPublicClient({ chain, transport: custom(provider) });
  const w = accounts.map(account => createWalletClient({ account, chain, transport: custom(provider) }));
  const [owner, agent, supplier, attacker, outsider, newPayout] = accounts;
  const W = { owner: w[0], agent: w[1], supplier: w[2], attacker: w[3], outsider: w[4] };
  const COOLDOWN = 120n;

  const deploy = async (name, args = []) => { const r = await pub.waitForTransactionReceipt({ hash: await w[0].deployContract({ ...artifacts[name], args }) }); assert.equal(r.status, 'success'); return r.contractAddress; };
  const read = (address, name, fn, args = []) => pub.readContract({ address, abi: artifacts[name].abi, functionName: fn, args });
  const write = async (wallet, address, name, fn, args = []) => {
    const { request } = await pub.simulateContract({ account: wallet.account, address, abi: artifacts[name].abi, functionName: fn, args });
    const r = await pub.waitForTransactionReceipt({ hash: await wallet.writeContract(request) }); assert.equal(r.status, 'success'); return r;
  };
  const deny = (wallet, address, name, fn, args, errorName) => assert.rejects(
    provider.request({ method: 'eth_call', params: [{ from: wallet.account.address, to: address, data: encodeFunctionData({ abi: artifacts[name].abi, functionName: fn, args }) }, 'latest'] }),
    e => { assert.equal(decodeErrorResult({ abi: artifacts[name].abi, data: e.data }).errorName, errorName); return true; });
  const warp = async s => { await provider.request({ method: 'evm_increaseTime', params: [Number(s)] }); await provider.request({ method: 'evm_mine', params: [] }); };
  const now = async () => (await pub.getBlock()).timestamp;

  const token = await deploy('TestToken');
  const factory = await deploy('ArcVaultFactory', [token]);
  const ledger = await deploy('EarlyPayLedger', [COOLDOWN]);
  await write(W.owner, factory, 'ArcVaultFactory', 'createVault');
  const vault = await read(factory, 'ArcVaultFactory', 'vaultOf', [owner.address]);
  await write(W.owner, token, 'TestToken', 'mint', [owner.address, 100_000_000n]);
  await write(W.owner, token, 'TestToken', 'approve', [vault, 50_000_000n]);
  await write(W.owner, vault, 'ArcVault', 'deposit', [50_000_000n]);
  const expires = (await now()) + 7n * 86400n;
  await write(W.owner, vault, 'ArcVault', 'authorize', [agent.address, { maxTotal: 50_000_000n, maxPayment: 10_000_000n, maxPerDay: 25_000_000n, gasAllowance: 0n, expiresAt: expires, useRegistry: false }, [supplier.address]]);

  const domain = { name: 'ArcSteward EarlyPay', version: '1', chainId: 31337, verifyingContract: ledger };
  const types = { Offer: [{ name: 'vault', type: 'address' }, { name: 'supplier', type: 'address' }, { name: 'invoiceHash', type: 'bytes32' }, { name: 'faceAmount', type: 'uint256' }, { name: 'discountBps', type: 'uint16' }, { name: 'payout', type: 'address' }, { name: 'dueDate', type: 'uint64' }, { name: 'expiry', type: 'uint64' }] };
  const inv = n => keccak256(toHex(`invoice-${n}`));
  const offer = async (n, extra = {}) => ({ vault, supplier: supplier.address, invoiceHash: inv(n), faceAmount: 10_000_000n, discountBps: 200, payout: supplier.address, dueDate: (await now()) + 60n * 86400n, expiry: (await now()) + 3600n, ...extra });
  const sign = (wallet, o) => wallet.signTypedData({ domain, types, primaryType: 'Offer', message: o });
  const head = () => read(ledger, 'EarlyPayLedger', 'chainHead', [vault]);

  await t.test('supplier registers; a fresh payout address is cooling down', async () => {
    await write(W.supplier, ledger, 'EarlyPayLedger', 'registerSupplier', [supplier.address, keccak256(toHex('Supplier A'))]);
    assert.equal(await read(ledger, 'EarlyPayLedger', 'payoutReady', [supplier.address]), false);
    const o = await offer(1);
    await deny(W.agent, ledger, 'EarlyPayLedger', 'checkOffer', [o, await sign(W.supplier, o)], 'PayoutCoolingDown');
    await warp(COOLDOWN);
    assert.equal(await read(ledger, 'EarlyPayLedger', 'payoutReady', [supplier.address]), true);
  });

  await t.test('signature must come from the supplier, offer must be unexpired and match the registered payout', async () => {
    const o = await offer(2);
    await deny(W.agent, ledger, 'EarlyPayLedger', 'checkOffer', [o, await sign(W.attacker, o)], 'BadSignature');
    const tampered = { ...o, faceAmount: 20_000_000n };
    await deny(W.agent, ledger, 'EarlyPayLedger', 'checkOffer', [tampered, await sign(W.supplier, o)], 'BadSignature');
    const redirected = { ...o, payout: attacker.address };
    await deny(W.agent, ledger, 'EarlyPayLedger', 'checkOffer', [redirected, await sign(W.supplier, redirected)], 'PayoutMismatch');
    const stale = { ...o, expiry: (await now()) - 1n };
    await deny(W.agent, ledger, 'EarlyPayLedger', 'checkOffer', [stale, await sign(W.supplier, stale)], 'OfferExpired');
    const stranger = { ...o, supplier: outsider.address, payout: outsider.address };
    await deny(W.agent, ledger, 'EarlyPayLedger', 'checkOffer', [stranger, await sign(W.outsider, stranger)], 'NotRegistered');
  });

  await t.test('only the vault owner or an active agent may record; chain links and cannot fork', async () => {
    const o = await offer(1);
    const sig = await sign(W.supplier, o);
    await deny(W.outsider, ledger, 'EarlyPayLedger', 'recordPayEarly', [o, sig, keccak256(toHex('inputs-1')), zeroHash, '{"reason":"test"}'], 'NotRecorder');
    const r = await write(W.agent, ledger, 'EarlyPayLedger', 'recordPayEarly', [o, sig, keccak256(toHex('inputs-1')), zeroHash, '{"reason":"test"}']);
    const ev = r.logs.map(l => decodeEventLog({ abi: artifacts.EarlyPayLedger.abi, ...l })).find(e => e.eventName === 'DecisionRecorded');
    assert.equal(ev.args.prevHash, zeroHash);
    assert.equal(await head(), ev.args.decisionHash);
    await deny(W.agent, ledger, 'EarlyPayLedger', 'recordDecision', [vault, inv(9), zeroHash, 1, keccak256(toHex('x')), zeroHash, ''], 'StaleChain');
    const h1 = await head();
    await write(W.owner, ledger, 'EarlyPayLedger', 'recordDecision', [vault, inv(3), zeroHash, 1, keccak256(toHex('inputs-3')), h1, 'hold']);
    assert.equal(await read(ledger, 'EarlyPayLedger', 'decisionCount', [vault]), 2n);
    assert.notEqual(await head(), h1);
  });

  await t.test('payment goes through the vault; settlement is recorded once and blocks a second early pay', async () => {
    const before = await read(token, 'TestToken', 'balanceOf', [supplier.address]);
    await write(W.agent, vault, 'ArcVault', 'pay', [supplier.address, 9_800_000n, inv(1)]);
    assert.equal(await read(token, 'TestToken', 'balanceOf', [supplier.address]) - before, 9_800_000n);
    await write(W.agent, ledger, 'EarlyPayLedger', 'recordSettlement', [vault, inv(1), supplier.address, 9_800_000n, keccak256(toHex('tx'))]);
    await deny(W.agent, ledger, 'EarlyPayLedger', 'recordSettlement', [vault, inv(1), supplier.address, 1n, keccak256(toHex('tx'))], 'AlreadySettled');
    const o = await offer(1);
    await deny(W.agent, ledger, 'EarlyPayLedger', 'checkOffer', [o, await sign(W.supplier, o)], 'AlreadySettled');
    await deny(W.agent, vault, 'ArcVault', 'pay', [supplier.address, 9_800_000n, inv(1)], 'DuplicatePayment');
  });

  await t.test('changing the payout address restarts the cooldown (anti-redirection)', async () => {
    await write(W.supplier, ledger, 'EarlyPayLedger', 'registerSupplier', [newPayout.address, keccak256(toHex('Supplier A'))]);
    const o = await offer(4, { payout: newPayout.address });
    await deny(W.agent, ledger, 'EarlyPayLedger', 'checkOffer', [o, await sign(W.supplier, o)], 'PayoutCoolingDown');
    await warp(COOLDOWN);
    await read(ledger, 'EarlyPayLedger', 'checkOffer', [o, await sign(W.supplier, o)]);
    // The attacker cannot change someone else's payout: registering only ever affects msg.sender.
    await write(W.attacker, ledger, 'EarlyPayLedger', 'registerSupplier', [attacker.address, zeroHash]);
    assert.equal((await read(ledger, 'EarlyPayLedger', 'suppliers', [supplier.address]))[0], newPayout.address);
  });

  await t.test('gasless: a relayer submits a supplier-signed registration and offer', async () => {
    const regTypes = { Registration: [{ name: 'supplier', type: 'address' }, { name: 'payout', type: 'address' }, { name: 'profileHash', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }] };
    const reg = { supplier: outsider.address, payout: outsider.address, profileHash: keccak256(toHex('Supplier B')), nonce: 0n };
    const sigReg = await W.outsider.signTypedData({ domain, types: regTypes, primaryType: 'Registration', message: reg });
    await deny(W.attacker, ledger, 'EarlyPayLedger', 'registerSupplierBySig', [outsider.address, attacker.address, reg.profileHash, sigReg], 'BadSignature');
    await write(W.attacker, ledger, 'EarlyPayLedger', 'registerSupplierBySig', [outsider.address, outsider.address, reg.profileHash, sigReg]);
    assert.equal((await read(ledger, 'EarlyPayLedger', 'suppliers', [outsider.address]))[0], outsider.address);
    await deny(W.attacker, ledger, 'EarlyPayLedger', 'registerSupplierBySig', [outsider.address, outsider.address, reg.profileHash, sigReg], 'BadSignature');
    const o = await offer(7, { supplier: outsider.address, payout: outsider.address });
    const sig = await W.outsider.signTypedData({ domain, types, primaryType: 'Offer', message: o });
    await deny(W.attacker, ledger, 'EarlyPayLedger', 'submitOffer', [{ ...o, faceAmount: 1n }, sig, '{}'], 'BadSignature');
    const r = await write(W.attacker, ledger, 'EarlyPayLedger', 'submitOffer', [o, sig, '{"number":"INV-7"}']);
    const ev = r.logs.map(l => decodeEventLog({ abi: artifacts.EarlyPayLedger.abi, ...l })).find(e => e.eventName === 'OfferSubmitted');
    assert.equal(ev.args.meta, '{"number":"INV-7"}'); assert.equal(ev.args.offer.faceAmount, o.faceAmount);
    await deny(W.attacker, ledger, 'EarlyPayLedger', 'submitOffer', [o, sig, '{}'], 'InvalidInput');
  });

  await t.test('revoked agents lose recording rights; the ledger never holds funds', async () => {
    await write(W.owner, vault, 'ArcVault', 'revoke', [agent.address]);
    await deny(W.agent, ledger, 'EarlyPayLedger', 'recordDecision', [vault, inv(5), zeroHash, 2, zeroHash, await head(), ''], 'NotRecorder');
    assert.equal(await read(token, 'TestToken', 'balanceOf', [ledger]), 0n);
    assert.equal(await pub.getBalance({ address: ledger }), 0n);
    assert.equal(artifacts.EarlyPayLedger.abi.some(f => f.stateMutability === 'payable'), false);
  });
});
