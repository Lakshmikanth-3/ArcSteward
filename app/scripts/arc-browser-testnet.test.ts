// Browser end-to-end on REAL Arc testnet: Playwright clicks through the live web app with an
// injected EIP-1193 wallet. Keys stay in this Node process; the page only sees addresses.
// Run: pnpm arc:testnet:browser   (E2E_BASE_URL defaults to https://velo402.vercel.app)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createPublicClient, createWalletClient, http, parseEther, erc20Abi, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arcTestnet, USDC } from '../src/lib/arc/config';
import { vaultAbi, factoryAbi } from '../src/lib/arc/abi';
import { director } from './arc-video';

const BASE = process.env.E2E_BASE_URL ?? 'https://velo402.vercel.app';
const FACTORY = '0xFBFB323cBc2D22A068553575d2221a70Fb4aaa25' as const;
const rpc = http(arcTestnet.rpcUrls.default.http[0], { retryCount: 2 });
const p = createPublicClient({ chain: arcTestnet, transport: rpc });

test('browser click-through on Arc testnet: owner funds and authorizes, agent pays, attacks rejected, owner revokes and withdraws', { timeout: 900_000 }, async () => {
  const funderKey = process.env.ARC_OWNER_PRIVATE_KEY as Hex | undefined;
  assert.ok(funderKey && /^0x[0-9a-fA-F]{64}$/.test(funderKey), 'ARC_OWNER_PRIVATE_KEY missing (pnpm arc:testnet:setup)');
  const funder = createWalletClient({ account: privateKeyToAccount(funderKey), chain: arcTestnet, transport: rpc });
  const owner = privateKeyToAccount(generatePrivateKey());
  const agent = privateKeyToAccount(generatePrivateKey());
  const outsider = privateKeyToAccount(generatePrivateKey()).address;
  for (const [to, v] of [[owner.address, '0.5'], [agent.address, '0.05']] as const)
    await p.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to, value: parseEther(v) }) });

  const wallets = { [owner.address]: createWalletClient({ account: owner, chain: arcTestnet, transport: rpc }), [agent.address]: createWalletClient({ account: agent, chain: arcTestnet, transport: rpc }) };
  let selected: `0x${string}` = owner.address;
  const hashes: string[] = [];
  // ARC_RECORD_DIR records a video of the run (used for the demo video).
  const record = process.env.ARC_RECORD_DIR;
  const browser = await chromium.launch({ slowMo: record ? 250 : 0 });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ...(record ? { recordVideo: { dir: record, size: { width: 1920, height: 1080 } } } : {}) });
    const page = await context.newPage();
    const d = director(page, record);
    const sec = (title: string) => page.locator('section', { hasText: title }).first();
    await page.exposeFunction('testWalletRequest', async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [selected];
      if (method === 'eth_chainId') return `0x${arcTestnet.id.toString(16)}`;
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      if (method === 'eth_sendTransaction') {
        const tx = (params?.[0] ?? {}) as { to: Hex; data?: Hex; value?: Hex; gas?: Hex };
        const hash = await wallets[selected].sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined, gas: tx.gas ? BigInt(tx.gas) : undefined });
        hashes.push(hash);
        return hash;
      }
      return p.request({ method, params } as never);
    });
    await page.addInitScript('window.ethereum = { request: (r) => window.testWalletRequest(r), on() {}, removeListener() {} };');
    if (d.enabled) {
      await page.goto(`${BASE}/`); await d.scene('p01', page.locator('.arc-home-hero'));
      await d.scene('p02', page.locator('#how-it-works'));
      await page.goto(`${BASE}/infrastructure`); await d.scene('p03', sec('Network configuration'));
      await page.goto(`${BASE}/security`); await d.scene('p04', sec('Threat model'));
      await d.scene('p05', sec('Live Arc testnet receipts'));
    }
    const status = page.getByRole('status');
    const connect = async (who: `0x${string}`) => { selected = who; await page.getByRole('button', { name: 'Connect EVM wallet' }).click(); await expect(status).toContainText('Wallet connected', { timeout: 30_000 }); };

    await page.goto(`${BASE}/testnet`);
    await page.getByRole('textbox', { name: 'Vault address' }).fill('');
    await page.getByLabel('Agent EVM address').fill('');
    await connect(owner.address);
    await d.scene('f01', sec('Connect your wallet'));

    // Owner: create vault from the verified factory.
    await page.getByRole('textbox', { name: /Factory address/ }).fill(FACTORY);
    await page.getByRole('button', { name: 'Create my vault' }).click();
    await expect(status).toContainText('Confirmed', { timeout: 90_000 });
    const vault = await p.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'vaultOf', args: [owner.address] });
    assert.notEqual(vault, '0x0000000000000000000000000000000000000000');
    await page.getByRole('textbox', { name: 'Vault address' }).fill(vault);
    // Public RPC can lag a block behind right after creation; retry like a user would.
    for (let i = 0; ; i++) {
      await page.getByRole('button', { name: 'Refresh on-chain state and history' }).click();
      try { await expect(status).toContainText('On-chain state refreshed', { timeout: 20_000 }); break; }
      catch (e) { if (i === 2) throw e; await page.waitForTimeout(3000); }
    }
    await d.scene('f02', sec('Create or load vault'));

    // Owner: deposit 0.1 USDC.
    await page.getByLabel('Deposit / withdrawal / payment amount (USDC)').fill('0.1');
    await page.getByRole('button', { name: 'Approve exact amount and deposit' }).click();
    await expect(page.getByText(/Available: 0.1 USDC/)).toBeVisible({ timeout: 120_000 });
    await d.scene('f03', page.locator('.arc-stat-grid'));

    // Owner: authorize agent (0.05 total, 0.02 per payment, owner is the only recipient).
    await page.getByLabel('Agent EVM address').fill(agent.address);
    await page.getByLabel('Lifetime total budget (USDC)').fill('0.05');
    await page.getByLabel('Maximum per payment (USDC)').fill('0.02');
    await page.getByLabel('Permitted recipients (comma separated)').fill(owner.address);
    const expiry = await page.evaluate('(() => { const d = new Date(Date.now() + 3600000); const pad = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; })()');
    await page.getByLabel('Expiry (your local time)').fill(String(expiry));
    await page.getByRole('button', { name: 'Authorize / update' }).click();
    await expect(page.getByText(/Active: true/)).toBeVisible({ timeout: 90_000 });
    await d.scene('f04', sec('Agent permissions'));
    // Agent: valid payment.
    await connect(agent.address);
    await page.getByLabel('Deposit / withdrawal / payment amount (USDC)').fill('0.02');
    await page.getByLabel('Payment recipient').fill(owner.address);
    await page.getByLabel('Unique invoice / payment ID').fill('browser-testnet-1');
    await page.getByRole('button', { name: 'Pay USDC' }).click();
    await expect(page.getByText(/Remaining: 0.03 USDC/)).toBeVisible({ timeout: 90_000 });
    const payHash = hashes[hashes.length - 1];
    await d.scene('f05', page.locator('.arc-stat-grid'));
    // Agent: manipulation attempts are rejected and move nothing.
    const attempts: [string, string, string, RegExp][] = [
      ['0.03', owner.address, 'browser-over-limit', /per-payment limit/],
      ['0.01', outsider, 'browser-outsider', /recipient is not permitted/],
      ['0.01', owner.address, 'browser-testnet-1', /already been used/],
    ];
    for (const [amount, to, id, error] of attempts) {
      const sent = hashes.length;
      await page.getByLabel('Deposit / withdrawal / payment amount (USDC)').fill(amount);
      await page.getByLabel('Payment recipient').fill(to);
      await page.getByLabel('Unique invoice / payment ID').fill(id);
      await page.getByRole('button', { name: 'Pay USDC' }).click();
      await expect(status).toContainText(error, { timeout: 30_000 });
      assert.equal(hashes.length, sent, `${id}: nothing was signed`);
      await d.scene(id === 'browser-over-limit' ? 'f07' : id === 'browser-outsider' ? 'f08' : 'f09', status);
    }
    assert.equal((await p.readContract({ address: vault, abi: vaultAbi, functionName: 'capabilities', args: [agent.address] }))[2], 20_000n);
    // Owner: revoke, then agent is refused.
    await connect(owner.address);
    await page.getByRole('button', { name: 'Revoke immediately' }).click();
    await expect(page.getByText(/Active: false/)).toBeVisible({ timeout: 90_000 });
    await d.scene('f10', page.locator('.arc-stat-grid'));
    await connect(agent.address);
    await page.getByLabel('Deposit / withdrawal / payment amount (USDC)').fill('0.01');
    await page.getByLabel('Unique invoice / payment ID').fill('browser-after-revoke');
    await page.getByRole('button', { name: 'Pay USDC' }).click();
    await expect(status).toContainText('Unauthorized', { timeout: 30_000 });
    await d.scene('f11', status);
    // Owner: withdraw the remaining 0.08 USDC; event history shows the full lifecycle.
    await connect(owner.address);
    await page.getByLabel('Deposit / withdrawal / payment amount (USDC)').fill('0.08');
    await page.getByRole('button', { name: 'Withdraw to owner' }).click();
    await expect(page.getByText(/Available: 0 USDC/)).toBeVisible({ timeout: 90_000 });
    await d.scene('f12', page.locator('.arc-stat-grid'));
    assert.equal(await p.readContract({ address: vault, abi: vaultAbi, functionName: 'balance' }), 0n);
    await page.waitForTimeout(3000);
    for (let i = 0; ; i++) {
      await page.getByRole('button', { name: 'Refresh on-chain state and history' }).click();
      try { await expect(status).toContainText('On-chain state refreshed', { timeout: 20_000 }); break; }
      catch (e) { if (i === 3) throw e; await page.waitForTimeout(4000); }
    }
    for (const ev of ['Funded', 'Authorized', 'Paid', 'Revoked', 'Withdrawn']) await expect(page.getByText(new RegExp(ev)).first()).toBeVisible({ timeout: 15_000 });
    await d.scene('f13', sec('Contract event history'));
    if (d.enabled) {
      await page.goto(`https://explorer.testnet.arc.io/tx/${payHash}`); await page.waitForLoadState('networkidle').catch(() => {});
      await d.scene('f06');
    }
    d.save();
    await page.screenshot({ path: '../contracts/arc/deployments/5042002-browser.png', fullPage: true });
    writeFileSync('../contracts/arc/deployments/5042002-browser.json', JSON.stringify({ chainId: arcTestnet.id, site: BASE, vault, owner: owner.address, agent: agent.address, transactions: hashes, status: 'PASS', testedAt: new Date().toISOString() }, null, 2));
    assert.ok(await p.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [owner.address] }) > 0n);
  } finally { await browser.close(); }  // closing flushes any recorded video
});
