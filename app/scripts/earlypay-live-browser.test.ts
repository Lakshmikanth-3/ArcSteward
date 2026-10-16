// Live end-to-end in a real browser against https://arcsteward.vercel.app (Arc TESTNET, real transactions).
// Supplier (phone) registers and invoices; buyer (desktop, owner wallet injected as an EIP-1193
// provider backed by the testnet owner key) approves the supplier, the hosted agent pays early,
// an over-limit invoice is escalated and paid by the owner, and the audit page verifies the chain.
// Usage: pnpm earlypay:live:browser   (env: .env.arc-testnet for ARC_OWNER_PRIVATE_KEY)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices, type Page } from '@playwright/test';
import { createPublicClient, createWalletClient, http, erc20Abi, parseEther, formatUnits, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arcTestnet, USDC } from '../src/lib/arc/config';
import { ledgerAbi } from '../src/lib/arc/abi';
import { LEDGER, LEDGER_FROM_BLOCK } from '../src/lib/earlypay/ledger';
import { fetchOffers, fetchDecisions } from '../src/lib/earlypay/chain';
import { encodeNote, inputsHash } from '../src/lib/earlypay/log';
import type { PublicClient } from 'viem';

const BASE = process.env.EARLYPAY_BASE_URL ?? 'https://arcsteward.vercel.app';
const transport = http(arcTestnet.rpcUrls.default.http[0], { retryCount: 6, retryDelay: 700 });
const pub = createPublicClient({ chain: arcTestnet, transport });
const owner = privateKeyToAccount(process.env.ARC_OWNER_PRIVATE_KEY as Hex);
const ownerWallet = createWalletClient({ account: owner, chain: arcTestnet, transport });
const payoutKey = generatePrivateKey();
const payout = privateKeyToAccount(payoutKey);
const usdcOf = (a: Hex) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] });
const tag = `E2E-${Date.now().toString(36)}`;

/** Injects window.ethereum backed by the owner key in Node (signing never leaves Node). */
async function injectOwnerWallet(page: Page) {
  await page.exposeFunction('__epRpc', async (method: string, params: unknown[] = []) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [owner.address];
    if (method === 'eth_chainId') return `0x${arcTestnet.id.toString(16)}`;
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
    if (method === 'eth_sendTransaction') {
      const tx = params[0] as { to: Hex; data?: Hex; value?: Hex; gas?: Hex };
      return ownerWallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined, gas: tx.gas ? BigInt(tx.gas) : undefined });
    }
    return pub.request({ method: method as never, params: params as never });
  });
  // Plain JS string: a compiled function could carry transpiler helpers that do not exist in the page.
  await page.addInitScript(`window.ethereum = { isMetaMask: true, request: ({ method, params }) => window.__epRpc(method, params || []), on() {}, removeListener() {} };`);
}

/** Clicks "Run the agent now" and waits until the run has finished (the button is re-enabled). */
async function runAgent(p: Page) {
  await p.getByRole('button', { name: /Run the agent now/ }).click();
  await p.getByRole('button', { name: /Run the agent now/ }).waitFor({ timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => ![...document.querySelectorAll('button')].some(b => /Agent deciding/.test(b.textContent ?? '')), undefined, { timeout: 180_000 });
  await p.waitForTimeout(2000);
}

const step = (name: string) => console.log(`\n▶ ${name}`);
const itemText = async (p: Page, invoice: string) => { const el = p.locator('.item', { hasText: invoice }).first(); await el.waitFor({ timeout: 90_000 }); return el.innerText(); };

test('EarlyPay live, in a real browser: supplier → agent → owner → audit', { timeout: 900_000 }, async () => {
  const browser = await chromium.launch();
  const errors: string[] = [];
  const supplier = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  const buyer = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  for (const p of [supplier, buyer]) p.on('pageerror', e => errors.push(e.message));
  buyer.on('dialog', d => d.accept());
  await injectOwnerWallet(buyer);
  const ownerStart = await usdcOf(owner.address);
  try {
    step('Supplier registers on a phone (gasless)');
    await supplier.goto(`${BASE}/earlypay/supplier`, { waitUntil: 'load' });
    await supplier.getByLabel('Your name or business').fill(`${tag} Studio`);
    await supplier.getByRole('textbox', { name: 'Wallet address' }).fill(payout.address);
    await supplier.getByRole('button', { name: /Sign & register/ }).click();
    await supplier.getByText(/Registered as/).first().waitFor({ timeout: 120_000 });

    step('Supplier sends invoice 1 (1 USDC, 2%, due in 60 days)');
    const due = new Date(Date.now() + 60 * 86400e3).toISOString().slice(0, 10);
    const sendInvoice = async (number: string, amount: string) => {
      await supplier.getByLabel('Invoice number').fill(number);
      await supplier.getByLabel('Amount (USDC)').fill(amount);
      await supplier.getByLabel('Due date').fill(due);
      await supplier.getByLabel(/Discount for paying today/).fill('2');
      await supplier.getByRole('button', { name: /Sign & send/ }).click();
      await supplier.getByText(new RegExp(`Invoice ${number} sent`)).first().waitFor({ timeout: 120_000 });
    };
    await sendInvoice(`${tag}-1`, '1');
    await supplier.waitForTimeout(8000);
    await supplier.reload({ waitUntil: 'load' });
    assert.match(await itemText(supplier, `${tag}-1`), /\b1\.00 USDC/);

    step('Agent waits out the 2-minute payout cooldown, then escalates (supplier not yet approved)');
    let t1 = '';
    for (let i = 0; i < 30 && !/ESCALATE/.test(t1); i++) {
      await buyer.goto(`${BASE}/earlypay/buyer`, { waitUntil: 'load' });
      await runAgent(buyer);
      t1 = await itemText(buyer, `${tag}-1`).catch(() => '');
    }
    console.log('  ', t1.replace(/\n/g, ' | ').slice(0, 220));
    assert.match(t1, /ESCALATE/);
    assert.match(t1, /NOT_APPROVED_SUPPLIER/);

    step('Owner connects wallet in the buyer page and approves the supplier (two-key rule)');
    await buyer.getByRole('button', { name: 'Connect owner wallet' }).click();
    await buyer.getByText(/· owner/).first().waitFor({ timeout: 30_000 });
    const card = buyer.locator('.item', { hasText: `${tag} Studio` }).first();
    await card.getByRole('button', { name: 'Approve supplier' }).click();
    await buyer.getByText(/Supplier approved on the vault/).first().waitFor({ timeout: 180_000 });
    console.log('  ', (await buyer.locator('.notice').last().innerText()).slice(0, 220));

    step('Agent re-decides: pays invoice 1 early from the vault');
    let paid = 0n;
    for (let i = 0; i < 12 && paid === 0n; i++) { paid = await usdcOf(payout.address); if (!paid) { await runAgent(buyer); await buyer.waitForTimeout(4000); } }
    console.log(`   supplier received ${formatUnits(paid, 6)} USDC`);
    assert.equal(paid, 980_000n);

    step('Supplier sends invoice 2 (6 USDC, over the 5 USDC per-payment limit)');
    await sendInvoice(`${tag}-2`, '6');
    let t2 = '';
    for (let i = 0; i < 12 && !/ESCALATE/.test(t2); i++) {
      await buyer.reload({ waitUntil: 'load' });
      await buyer.getByRole('button', { name: 'Connect owner wallet' }).click().catch(() => {});
      await runAgent(buyer);
      t2 = await itemText(buyer, `${tag}-2`).catch(() => '');
    }
    console.log('  ', t2.replace(/\n/g, ' | ').slice(0, 220));
    assert.match(t2, /ESCALATE/);

    step('Owner clicks "Approve & pay myself": pays from the owner wallet, HUMAN_APPROVED recorded');
    await buyer.getByText(/· owner/).first().waitFor({ timeout: 30_000 }).catch(async () => { await buyer.getByRole('button', { name: 'Connect owner wallet' }).click(); });
    await buyer.locator('.item', { hasText: `${tag}-2` }).first().getByRole('button', { name: /Approve & pay/ }).click();
    await buyer.getByText(/Paid 5\.88 USDC from your wallet/).first().waitFor({ timeout: 240_000 });
    assert.equal(await usdcOf(payout.address), 980_000n + 5_880_000n);

    step('Supplier sees both invoices PAID with explorer links');
    await supplier.reload({ waitUntil: 'load' });
    await supplier.waitForTimeout(6000);
    for (const n of [`${tag}-1`, `${tag}-2`]) assert.match(await itemText(supplier, n), /PAID/);

    step('Audit page recomputes the hash chain in the browser');
    await buyer.goto(`${BASE}/earlypay/audit`, { waitUntil: 'load' });
    await buyer.getByText(/Hash chain verified in your browser/).first().waitFor({ timeout: 60_000 });
    await buyer.getByLabel(/Filter by invoice/).fill(tag);
    const audit = await buyer.locator('.item').allInnerTexts();
    console.log(`   ${audit.length} decisions for ${tag}: ${audit.map(a => a.match(/(PAY EARLY|HUMAN APPROVED|ESCALATE|HOLD|REJECT)/)?.[0]).join(', ')}`);
    assert.ok(audit.some(a => /PAY EARLY/.test(a)) && audit.some(a => /HUMAN APPROVED/.test(a)));
    assert.deepEqual(errors, []);
  } catch (e) {
    await supplier.screenshot({ path: 'test-results/live-supplier-fail.png', fullPage: true }).catch(() => {});
    await buyer.screenshot({ path: 'test-results/live-buyer-fail.png', fullPage: true }).catch(() => {});
    console.log('FAILED STEP DETAIL:', e instanceof Error ? e.message.split(/\r?\n/).slice(0, 4).join(' ') : e);
    throw e;
  } finally {
    step('Cleanup: owner declines leftover escalated E2E test invoices; test supplier returns its USDC');
    try {
      const vault = (await (await fetch(`${BASE}/api/earlypay/state`)).json()).vault as Hex;
      const ledger = LEDGER.testnet!;
      const [offers, decisions] = await Promise.all([fetchOffers(pub as PublicClient, ledger, LEDGER_FROM_BLOCK.testnet, vault), fetchDecisions(pub as PublicClient, ledger, LEDGER_FROM_BLOCK.testnet, vault)]);
      const latest = new Map(decisions.map(d => [d.offerHash.toLowerCase(), d.decision]));
      for (const o of offers.filter(x => /^e2e-/i.test(x.meta.supplierName ?? '') && latest.get(x.offerHash.toLowerCase()) === 'ESCALATE')) {
        const prev = await pub.readContract({ address: ledger, abi: ledgerAbi, functionName: 'chainHead', args: [vault] }) as Hex;
        const inputs = { invoiceHash: o.offer.invoiceHash, by: 'owner', action: 'declined automated test invoice' };
        const h = await ownerWallet.writeContract({ address: ledger, abi: ledgerAbi, functionName: 'recordDecision', args: [vault, o.offer.invoiceHash, o.offerHash, 3, inputsHash(inputs), prev, encodeNote({ reason: 'Owner declined an automated test invoice.', source: 'owner', inputs })] });
        await pub.waitForTransactionReceipt({ hash: h });
        console.log(`   declined ${o.meta.number}`);
      }
    } catch (e) { console.log('   cleanup of test invoices skipped:', e instanceof Error ? e.message.split(String.fromCharCode(10))[0] : e); }
    const bal = await pub.getBalance({ address: payout.address });
    if (bal > parseEther('0.01')) {
      const w = createWalletClient({ account: payout, chain: arcTestnet, transport });
      await pub.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: owner.address, value: bal - parseEther('0.01') }) });
    }
    console.log(`   owner net spend: ${formatUnits(ownerStart - await usdcOf(owner.address), 6)} USDC (gas + 0.02 discount + 0.12 discount kept as cost)`);
    await browser.close();
  }
});
