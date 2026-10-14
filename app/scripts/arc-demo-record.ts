// Records the narrated product walkthrough on REAL Arc testnet (used for the demo video).
// Each step runs its action, zooms to the relevant control, and holds for its narration length.
// Run: DEMO_DIR=<dir with dur.json> pnpm tsx --env-file=.env.arc-testnet scripts/arc-demo-record.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Locator, type Page } from '@playwright/test';
import { createPublicClient, createWalletClient, http, parseEther, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from '../src/lib/arc/config';
import { factoryAbi, vaultAbi } from '../src/lib/arc/abi';

const DIR = process.env.DEMO_DIR!;
const BASE = process.env.E2E_BASE_URL ?? 'https://velo402.vercel.app';
const FACTORY = '0xFBFB323cBc2D22A068553575d2221a70Fb4aaa25' as const;
const dur = JSON.parse(readFileSync(`${DIR}/dur.json`, 'utf8')) as Record<string, number>;
const rpc = http(arcTestnet.rpcUrls.default.http[0], { retryCount: 2 });
const p = createPublicClient({ chain: arcTestnet, transport: rpc });

async function main() {
  const funder = createWalletClient({ account: privateKeyToAccount(process.env.ARC_OWNER_PRIVATE_KEY as Hex), chain: arcTestnet, transport: rpc });
  const owner = privateKeyToAccount(generatePrivateKey()), agent = privateKeyToAccount(generatePrivateKey());
  const stranger = privateKeyToAccount(generatePrivateKey()).address;
  for (const [to, v] of [[owner.address, '0.5'], [agent.address, '0.05']] as const) await p.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to, value: parseEther(v) }) });
  const wallets = { [owner.address]: createWalletClient({ account: owner, chain: arcTestnet, transport: rpc }), [agent.address]: createWalletClient({ account: agent, chain: arcTestnet, transport: rpc }) };
  let selected: `0x${string}` = owner.address;
  let payHash = '';

  const browser = await chromium.launch({ slowMo: 60 });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: DIR, size: { width: 1920, height: 1080 } } });
  const page = await ctx.newPage();
  await page.exposeFunction('testWalletRequest', async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [selected];
    if (method === 'eth_chainId') return `0x${arcTestnet.id.toString(16)}`;
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
    if (method === 'eth_sendTransaction') {
      const tx = (params?.[0] ?? {}) as { to: Hex; data?: Hex; value?: Hex; gas?: Hex };
      return wallets[selected].sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined, gas: tx.gas ? BigInt(tx.gas) : undefined });
    }
    return p.request({ method, params } as never);
  });
  await page.addInitScript('window.ethereum = { request: (r) => window.testWalletRequest(r), on() {}, removeListener() {} };');

  const t0 = Date.now(), marks: Record<string, number> = {};
  const status = page.getByRole('status');
  const wait = (s: number) => page.waitForTimeout(s * 1000);
  // Caption bar + zoom helpers, injected into the page (visual only).
  const caption = (text: string) => page.evaluate(t => {
    let el = document.getElementById('demo-cap');
    if (!el) { el = document.createElement('div'); el.id = 'demo-cap'; el.style.cssText = 'position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:99999;background:#04110cf0;color:#fff;border:1px solid #b2e8bf55;border-radius:14px;padding:16px 30px;font:600 30px Inter,system-ui;box-shadow:0 20px 60px #000a;max-width:1600px;text-align:center'; document.body.appendChild(el); }
    el.innerHTML = t; el.animate([{ opacity: 0, transform: 'translate(-50%,20px)' }, { opacity: 1, transform: 'translate(-50%,0)' }], { duration: 400, fill: 'forwards' });
  }, text);
  const zoom = async (loc: Locator, max = 1.9) => {
    await loc.scrollIntoViewIfNeeded(); await wait(0.3);
    await loc.evaluate((el, max) => {
      const root = document.querySelector('.arc-workspace, .arc-home') as HTMLElement; const r = el.getBoundingClientRect(), c = root.getBoundingClientRect();
      const s = Math.max(1, Math.min(max, 1500 / r.width, 760 / r.height));
      root.style.transition = 'transform 1.1s cubic-bezier(.2,.8,.2,1)'; root.style.transformOrigin = `${r.x - c.x + r.width / 2}px ${r.y - c.y + r.height / 2}px`;
      root.style.transform = `translate(${960 - (r.x + r.width / 2)}px, ${500 - (r.y + r.height / 2)}px) scale(${s})`;
      (el as HTMLElement).style.boxShadow = '0 0 0 3px #5fe3a1, 0 0 40px #5fe3a188'; (el as HTMLElement).style.borderRadius ||= '12px';
      (window as unknown as { __hl: HTMLElement[] }).__hl = [...((window as unknown as { __hl?: HTMLElement[] }).__hl ?? []), el as HTMLElement];
    }, max);
    await wait(1.2);
  };
  const unzoom = async () => { await page.evaluate(() => { const root = document.querySelector('.arc-workspace, .arc-home') as HTMLElement; if (root) root.style.transform = 'none'; for (const e of (window as unknown as { __hl?: HTMLElement[] }).__hl ?? []) e.style.boxShadow = ''; (window as unknown as { __hl: HTMLElement[] }).__hl = []; }); await wait(1.1); await page.evaluate(() => { const root = document.querySelector('.arc-workspace, .arc-home') as HTMLElement; if (root) { root.style.transition = ''; root.style.transform = ''; } }); };
  const step = async (id: string, cap: string, action: () => Promise<void>) => {
    const start = (Date.now() - t0) / 1000; marks[id] = start; console.log('step', id, start.toFixed(1));
    await caption(cap);
    try { await action(); } catch (e) { await page.screenshot({ path: `${DIR}/fail-${id}.png` }); console.log('STATUS', await status.textContent().catch(() => '')); throw e; }
    const left = dur[id] + 0.8 - ((Date.now() - t0) / 1000 - start); if (left > 0) await wait(left);
  };
  const connect = async (who: `0x${string}`) => { selected = who; await page.getByRole('button', { name: 'Connect EVM wallet' }).click(); await status.filter({ hasText: 'Wallet connected' }).waitFor({ timeout: 30_000 }); };
  const type = (label: string | RegExp, v: string) => page.getByLabel(label).pressSequentially(v, { delay: 35 });
  const clear = async (label: string | RegExp) => page.getByLabel(label).fill('');
  const statusHas = (t: RegExp | string, timeout = 90_000) => status.filter({ hasText: t }).waitFor({ timeout });

  await page.goto(BASE); await page.waitForLoadState('networkidle');
  await step('d0', 'Home page · velo402.vercel.app', async () => { await wait(2); await zoom(page.locator('.arc-home-hero-copy'), 1.5); await wait(4); await unzoom(); });
  await step('d0b', 'Capabilities and the payment journey', async () => { await page.locator('#how-it-works').scrollIntoViewIfNeeded(); await wait(1); await zoom(page.locator('.arc-home-steps'), 1.4); await wait(3); await unzoom(); });
  await page.goto(`${BASE}/infrastructure`); await page.waitForLoadState('networkidle');
  await step('d1', 'Infrastructure · networks, RPC endpoints, USDC contract', async () => { await wait(1.5); await zoom(page.locator('table').first(), 1.5); await wait(5); await unzoom(); });
  await page.goto(`${BASE}/security`); await page.waitForLoadState('networkidle');
  await step('d2', 'Security proof · each attack and the rule that blocks it', async () => { await wait(1); await zoom(page.locator('table').first(), 1.35); await wait(4); await unzoom(); });
  await page.goto(`${BASE}/testnet`); await page.waitForLoadState('networkidle');
  await page.getByRole('textbox', { name: 'Vault address' }).fill('');
  await step('d3', 'Vault console · Arc Testnet · real transactions', async () => { await wait(2); await zoom(page.getByRole('button', { name: 'Connect EVM wallet' }).locator('xpath=ancestor::section[1]')); await connect(owner.address); await wait(2); await unzoom(); });

  await step('d4', 'Step 1 · Owner creates a vault from the factory', async () => {
    const f = page.getByRole('textbox', { name: /Factory address/ }); await zoom(f.locator('xpath=ancestor::section[1]'), 1.6);
    await f.fill(FACTORY); await page.getByRole('button', { name: 'Create my vault' }).click(); await statusHas('Confirmed');
    const vault = await p.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'vaultOf', args: [owner.address] });
    await page.getByRole('textbox', { name: 'Vault address' }).fill(vault);
    for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Refresh on-chain state and history' }).click(); try { await statusHas('On-chain state refreshed', 20_000); break; } catch { await wait(3); } }
    await wait(1.5); await unzoom();
  });
  await step('d5', 'Step 2 · Owner deposits 0.1 USDC', async () => {
    await zoom(page.getByLabel('Deposit / withdrawal / payment amount (USDC)'), 1.6);
    await clear('Deposit / withdrawal / payment amount (USDC)'); await type('Deposit / withdrawal / payment amount (USDC)', '0.1');
    await page.getByRole('button', { name: 'Approve exact amount and deposit' }).click();
    await page.getByText(/Available: 0.1 USDC/).waitFor({ timeout: 120_000 }); await unzoom(); await zoom(page.locator('.arc-stat').first(), 1.8); await wait(2); await unzoom();
  });
  await step('d6', 'Step 3 · Owner authorizes the agent', async () => {
    await zoom(page.getByLabel('Agent EVM address').locator('xpath=ancestor::section[1]'), 1.5);
    await clear('Agent EVM address'); await type('Agent EVM address', agent.address);
    await clear('Lifetime total budget (USDC)'); await type('Lifetime total budget (USDC)', '0.05');
    await clear('Maximum per payment (USDC)'); await type('Maximum per payment (USDC)', '0.02');
    await clear('Permitted recipients (comma separated)'); await type('Permitted recipients (comma separated)', owner.address);
    const expiry = await page.evaluate('(() => { const d = new Date(Date.now() + 3600000); const pad = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; })()');
    await page.getByLabel('Expiry (your local time)').fill(String(expiry));
  });
  await step('d6b', 'Capability active on-chain', async () => { await page.getByRole('button', { name: 'Authorize / update' }).click(); await page.getByText(/Active: true/).waitFor({ timeout: 90_000 }); await unzoom(); await zoom(page.locator('.arc-stat').nth(1), 1.8); await wait(1.5); await unzoom(); });

  const pay = async (amount: string, to: string, id: string) => {
    await clear('Deposit / withdrawal / payment amount (USDC)'); await type('Deposit / withdrawal / payment amount (USDC)', amount);
    await clear('Payment recipient'); await type('Payment recipient', to);
    await clear('Unique invoice / payment ID'); await type('Unique invoice / payment ID', id);
    await page.getByRole('button', { name: 'Pay USDC' }).click();
  };
  await step('d7', 'Step 4 · Agent pays 0.02 USDC on its own', async () => {
    await connect(agent.address); await zoom(page.getByLabel('Payment recipient').locator('xpath=ancestor::section[1]'), 1.4);
    await pay('0.02', owner.address, 'invoice-001'); await page.getByText(/Remaining: 0.03 USDC/).waitFor({ timeout: 90_000 });
    await unzoom(); await zoom(page.locator('.arc-stat').nth(2), 1.8); await wait(2); await unzoom();
  });
  const attack = async (id: string, cap: string, amount: string, to: string, pid: string, msg: RegExp) => step(id, cap, async () => {
    await zoom(page.getByLabel('Payment recipient').locator('xpath=ancestor::section[1]'), 1.4);
    await pay(amount, to, pid); await statusHas(msg, 30_000); await unzoom(); await zoom(status, 1.8); await wait(2.5); await unzoom();
  });
  await attack('d8', 'Attack 1 · 0.03 USDC, over the per-payment limit → REJECTED', '0.03', owner.address, 'invoice-002', /per-payment limit/);
  await attack('d9', 'Attack 2 · pay a stranger not on the allowlist → REJECTED', '0.01', stranger, 'invoice-003', /recipient is not permitted/);
  await attack('d10', 'Attack 3 · replay invoice-001 to get paid twice → REJECTED', '0.01', owner.address, 'invoice-001', /already been used/);
  await step('d11', 'Step 5 · Owner revokes the agent', async () => {
    await connect(owner.address); await zoom(page.getByRole('button', { name: 'Revoke immediately' }), 1.8);
    await page.getByRole('button', { name: 'Revoke immediately' }).click(); await page.getByText(/Active: false/).waitFor({ timeout: 90_000 }); await unzoom(); await zoom(page.locator('.arc-stat').nth(1), 1.8); await wait(1.5); await unzoom();
  });
  await step('d12', 'Agent tries again → REFUSED: Unauthorized', async () => {
    await connect(agent.address); await pay('0.01', owner.address, 'invoice-004'); await statusHas('Unauthorized', 30_000); await zoom(status, 1.8); await wait(2); await unzoom();
  });
  await step('d13', 'Step 6 · Owner withdraws the remaining 0.08 USDC', async () => {
    await connect(owner.address); await zoom(page.getByRole('button', { name: 'Withdraw to owner' }).locator('xpath=ancestor::section[1]'), 1.5);
    await clear('Deposit / withdrawal / payment amount (USDC)'); await type('Deposit / withdrawal / payment amount (USDC)', '0.08');
    await page.getByRole('button', { name: 'Withdraw to owner' }).click(); await page.getByText(/Available: 0 USDC/).waitFor({ timeout: 90_000 }); await unzoom();
  });
  await step('d14', 'Event history · read directly from Arc', async () => {
    await wait(2); for (let i = 0; i < 4; i++) { await page.getByRole('button', { name: 'Refresh on-chain state and history' }).click(); try { await statusHas('On-chain state refreshed', 20_000); break; } catch (e) { if (i === 3) throw e; await wait(3); } }
    const hist = page.getByText('Contract event history').locator('xpath=ancestor::section[1]'); await hist.scrollIntoViewIfNeeded(); await wait(1); await zoom(hist, 1.3); await wait(6); await unzoom();
    const vault = await p.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'vaultOf', args: [owner.address] });
    const logs = await p.getContractEvents({ address: vault, abi: vaultAbi, eventName: 'Paid', fromBlock: (await p.getBlockNumber()) - 5000n });
    payHash = logs[0]?.transactionHash ?? '';
  });
  await step('d15', 'Proof · the payment on the Arc Testnet explorer', async () => {
    await page.goto(`https://explorer.testnet.arc.io/tx/${payHash}`, { timeout: 30_000 }).catch(() => {}); await wait(4);
    await caption(`Paid · ${payHash.slice(0, 10)}…${payHash.slice(-8)}`);
  });
  marks.end = (Date.now() - t0) / 1000;
  const video = page.video()!; await ctx.close(); await browser.close();
  writeFileSync(`${DIR}/demo-marks.json`, JSON.stringify({ marks, video: await video.path(), payHash, owner: owner.address, agent: agent.address }, null, 2));
  console.log('done', marks.end);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
