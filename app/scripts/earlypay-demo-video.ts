// Records the ArcSteward EarlyPay demo video (≤3 min, burned-in subtitles, visible cursor)
// against the LIVE site on Arc TESTNET with real transactions, then joins clips with ffmpeg.
// Usage: pnpm earlypay:demo:video   (env: .env.arc-testnet for ARC_OWNER_PRIVATE_KEY)
import { mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium, type Browser, type BrowserContext, type Page, type Locator } from '@playwright/test';
import { createPublicClient, createWalletClient, http, keccak256, toHex, parseEther, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from '../src/lib/arc/config';
import { ledgerAbi } from '../src/lib/arc/abi';
import { LEDGER, LEDGER_FROM_BLOCK, domain, registrationTypes } from '../src/lib/earlypay/ledger';
import { fetchOffers, fetchDecisions } from '../src/lib/earlypay/chain';
import { encodeNote, inputsHash } from '../src/lib/earlypay/log';
import type { PublicClient } from 'viem';
import { canonical } from '../src/lib/earlypay/log';

const BASE = 'https://arcsteward.vercel.app';
const OUT = '../demo/earlypay';
const W = 1920, H = 1080;
const transport = http(arcTestnet.rpcUrls.default.http[0], { retryCount: 6, retryDelay: 700 });
const pub = createPublicClient({ chain: arcTestnet, transport });
const owner = privateKeyToAccount(process.env.ARC_OWNER_PRIVATE_KEY as Hex);
const ownerWallet = createWalletClient({ account: owner, chain: arcTestnet, transport });
const supplierKey = generatePrivateKey(), supplier = privateKeyToAccount(supplierKey);
const payoutKey = generatePrivateKey(), payout = privateKeyToAccount(payoutKey);
const SUPPLIER_NAME = 'Asha Design Studio';
const INV = `INV-${Date.now().toString(36).slice(-4).toUpperCase()}`;

// ── overlays: subtitle bar + visible cursor (plain JS so nothing transpiled leaks into the page) ──
const OVERLAY = `(() => {
  const mk = () => {
    if (document.getElementById('__cap')) return;
    const cap = document.createElement('div'); cap.id = '__cap';
    cap.style.cssText = 'position:fixed;left:50%;bottom:34px;transform:translateX(-50%);max-width:92%;width:max-content;z-index:2147483647;background:rgba(18,12,8,.88);color:#f4ede4;font:500 clamp(15px,1.45vw,27px)/1.35 "IBM Plex Mono",ui-monospace,monospace;padding:12px 22px;text-align:center;pointer-events:none;display:none';
    const cur = document.createElement('div'); cur.id = '__cur';
    cur.style.cssText = 'position:fixed;left:-40px;top:-40px;width:22px;height:22px;z-index:2147483647;pointer-events:none;border-radius:50%;background:rgba(217,119,63,.85);border:3px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.35);transform:translate(-50%,-50%);transition:transform .08s';
    document.documentElement.append(cap, cur);
    addEventListener('mousemove', e => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { cur.style.transform = 'translate(-50%,-50%) scale(.7)'; }, true);
    addEventListener('mouseup', () => { cur.style.transform = 'translate(-50%,-50%)'; }, true);
  };
  window.__caption = t => { mk(); const c = document.getElementById('__cap'); c.textContent = t || ''; c.style.display = t ? 'block' : 'none'; };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mk); else mk();
})();`;

// ── narration: Windows TTS per caption; subtitles are burned in later from the exact timings ──
type Cue = { clip: number; t: number; text: string; wav: string; dur: number };
const cues: Cue[] = [];
let ttsN = 0;
function speak(text: string): { wav: string; dur: number } {
  const wav = `${OUT}/raw/tts-${String(ttsN++).padStart(3, '0')}.wav`;
  const txt = wav.replace('.wav', '.txt');
  writeFileSync(txt, text);
  execFileSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('Microsoft Zira Desktop'); $s.Rate = 1; $s.SetOutputToWaveFile('${wav}'); $s.Speak([IO.File]::ReadAllText('${txt}')); $s.Dispose()`]);
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString());
  return { wav, dur };
}
/** Narrates `text`, records the cue, and holds the frame until the line is spoken (and at least `hold` ms). */
async function caption(p: Page, text: string, hold = 0) {
  const t0 = Date.now();
  const { wav, dur } = speak(text);           // synthesis time is cut from the video
  idle.push([(t0 - clipT0) / 1000, (Date.now() - clipT0) / 1000]);
  cues.push({ clip: clips.length, t: (Date.now() - clipT0) / 1000, text, wav, dur });
  await p.waitForTimeout(Math.max(hold, dur * 1000 + 350));
}
/** Runs a slow step (agent run, chain confirmation) whose waiting time is cut from the video. */
async function offCamera<T>(fn: () => Promise<T>): Promise<T> {
  const a = (Date.now() - clipT0) / 1000;
  try { return await fn(); } finally { idle.push([a, (Date.now() - clipT0) / 1000]); }
}
let idle: [number, number][] = [];
async function move(p: Page, l: Locator) {
  await l.scrollIntoViewIfNeeded();
  const b = await l.boundingBox(); if (!b) return;
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
}
async function click(p: Page, l: Locator) { await move(p, l); await p.waitForTimeout(250); await l.click(); }
async function type(p: Page, l: Locator, text: string) { await click(p, l); await l.fill(''); await l.pressSequentially(text, { delay: 35 }); }

// ── clip management: each section is one context = one webm ──
let browser: Browser;
const clips: { file: string; speed: number; start: number; idle: [number, number][]; end: number }[] = [];
let clipT0 = 0, clipStart = 0;
const ready = () => { clipStart = (Date.now() - clipT0) / 1000; };
async function section(name: string, speed: number, opts: { mobile?: boolean; wallet?: boolean; init?: string } , body: (p: Page, ctx: BrowserContext) => Promise<void>) {
  const dir = `${OUT}/raw/${String(clips.length).padStart(2, '0')}-${name}`;
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: opts.mobile ? { width: 430, height: 932 } : { width: W, height: H },
    deviceScaleFactor: 1, isMobile: !!opts.mobile, hasTouch: !!opts.mobile,
    recordVideo: { dir, size: opts.mobile ? { width: 430, height: 932 } : { width: W, height: H } },
  });
  await ctx.addInitScript(OVERLAY);
  if (opts.init) await ctx.addInitScript(opts.init);
  clipT0 = Date.now(); clipStart = 0; idle = [];
  const page = await ctx.newPage();
  if (opts.wallet) {
    await page.exposeFunction('__epRpc', async (method: string, params: unknown[] = []) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [owner.address];
      if (method === 'eth_chainId') return `0x${arcTestnet.id.toString(16)}`;
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      if (method === 'eth_sendTransaction') { const t = params[0] as { to: Hex; data?: Hex; value?: Hex; gas?: Hex }; return ownerWallet.sendTransaction({ to: t.to, data: t.data, value: t.value ? BigInt(t.value) : undefined, gas: t.gas ? BigInt(t.gas) : undefined }); }
      return pub.request({ method: method as never, params: params as never });
    });
    await page.addInitScript('window.ethereum = { isMetaMask: true, request: ({ method, params }) => window.__epRpc(method, params || []), on() {}, removeListener() {} };');
    page.on('dialog', d => d.accept());
  }
  console.log(`● ${name}`);
  await body(page, ctx);
  const end = (Date.now() - clipT0) / 1000;
  await ctx.close();
  const webm = readdirSync(dir).find(f => f.endsWith('.webm'))!;
  clips.push({ file: `${dir}/${webm}`, speed, start: Math.max(0, clipStart - 0.2), idle: [...idle], end });
}

// ── slides (codex style) ──
const FONT = '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">';
const slideCss = `*{box-sizing:border-box;margin:0}body{width:${W}px;height:${H}px;background:#efe7d8;color:#1b130c;font-family:'IBM Plex Mono',monospace;padding:110px 140px;overflow:hidden}
h1,h2{font-family:'Instrument Serif',serif;font-weight:400;letter-spacing:-.02em}em{color:#b8561f}.k{font-size:22px;letter-spacing:.22em;text-transform:uppercase;color:#b8561f}
h1{font-size:150px;line-height:.92;margin-top:24px}h2{font-size:96px;line-height:1;margin-top:20px;max-width:16ch}p{font-size:30px;line-height:1.55;color:#4a3d30;margin-top:34px;max-width:1300px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border-top:2px solid #1b130c;margin-top:60px}.grid div{padding:30px 40px 0 0}.grid b{display:block;font-family:'Instrument Serif',serif;font-weight:400;font-size:110px;line-height:1;color:#b8561f}.grid span{font-size:24px;color:#4a3d30;line-height:1.45;display:block;margin-top:8px}
.rows{margin-top:44px;border-top:2px solid #1b130c}.rows div{display:grid;grid-template-columns:420px 1fr;gap:30px;padding:22px 0;border-bottom:1px dashed #d9ccb4;font-size:27px;color:#4a3d30}.rows b{font-family:'Instrument Serif',serif;font-weight:400;font-size:44px;color:#1b130c}
.coin{position:absolute;right:140px;top:110px;width:300px;border-radius:50%}.src{position:absolute;left:140px;bottom:60px;font-size:18px;color:#7a6a58}`;
const slide = (inner: string) => `<!doctype html><html><head><meta charset="utf-8">${FONT}<style>${slideCss}</style></head><body>${inner}</body></html>`;

const ARCH = `<svg width="1640" height="700" viewBox="0 0 1640 700" font-family="IBM Plex Mono" font-size="21">
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="#1b130c"/></marker></defs>
<g fill="#f6f0e4" stroke="#1b130c" stroke-width="2">
<rect x="0" y="40" width="300" height="130"/><rect x="0" y="420" width="300" height="130"/>
<rect x="420" y="40" width="360" height="130"/><rect x="420" y="250" width="360" height="190" fill="#1b130c"/>
<rect x="900" y="40" width="330" height="130"/><rect x="900" y="300" width="330" height="140"/><rect x="900" y="520" width="330" height="140"/>
<rect x="1340" y="300" width="300" height="140"/></g>
<g fill="#1b130c"><text x="24" y="95" font-family="Instrument Serif" font-size="36">Supplier (phone)</text><text x="24" y="135">signs registration</text><text x="24" y="160">+ EIP-712 offer</text>
<text x="24" y="475" font-family="Instrument Serif" font-size="36">Owner (buyer)</text><text x="24" y="515">approves supplier,</text><text x="24" y="540">resolves escalations</text>
<text x="444" y="95" font-family="Instrument Serif" font-size="36">Gasless relay API</text><text x="444" y="135">/api/earlypay/relay</text>
<text x="924" y="95" font-family="Instrument Serif" font-size="36">EarlyPayLedger</text><text x="924" y="130">registry · offers ·</text><text x="924" y="155">hash-chained decisions</text>
<text x="924" y="355" font-family="Instrument Serif" font-size="36">ArcVault</text><text x="924" y="392">per-payment / daily /</text><text x="924" y="417">total limits, allowlist</text>
<text x="924" y="575" font-family="Instrument Serif" font-size="36">Audit page</text><text x="924" y="612">recomputes the chain</text><text x="924" y="637">in the browser</text>
<text x="1364" y="355" font-family="Instrument Serif" font-size="36">USDC on Arc</text><text x="1364" y="392">sub-second settlement</text><text x="1364" y="417">USDC = gas</text></g>
<g fill="#f4ede4"><text x="444" y="300" font-family="Instrument Serif" font-size="38">Treasury agent (AI)</text><text x="444" y="340">deterministic APR, yield,</text><text x="444" y="368">runway + risk checks →</text><text x="444" y="396">LLM decides within a ceiling</text><text x="444" y="424" fill="#f0a878">PAY · HOLD · ESCALATE · REJECT</text></g>
<g stroke="#1b130c" stroke-width="2.5" fill="none" marker-end="url(#a)">
<path d="M300 105H418"/><path d="M780 105H898"/><path d="M1065 170V248"/><path d="M898 100C840 160 820 230 782 260"/><path d="M782 360H898"/><path d="M782 400C840 470 860 560 898 585"/><path d="M1232 370H1338"/><path d="M300 485C600 485 780 430 898 410"/></g></svg>`;

async function slideSection(name: string, html: string, captionText: string, ms: number) {
  await section(name, 1, {}, async p => { await p.setContent(html, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(200); ready(); await caption(p, captionText, ms); });
}

async function relayRegister() {
  const ledger = LEDGER.testnet!;
  const profileHash = keccak256(toHex(canonical({ name: SUPPLIER_NAME, contact: '' })));
  const nonce = await pub.readContract({ address: ledger, abi: ledgerAbi, functionName: 'nonces', args: [supplier.address] }) as bigint;
  const signature = await supplier.signTypedData({ domain: domain(arcTestnet.id, ledger), types: registrationTypes, primaryType: 'Registration', message: { supplier: supplier.address, payout: payout.address, profileHash, nonce } });
  const r = await fetch(`${BASE}/api/earlypay/relay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'register', supplier: supplier.address, payout: payout.address, profileHash, signature }) });
  if (!r.ok) throw new Error(`register: ${await r.text()}`);
}

async function main() {
  if (existsSync(`${OUT}/raw`)) rmSync(`${OUT}/raw`, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  browser = await chromium.launch();
  // Pre-stage (not recorded): clear escalations left by earlier rehearsals so the buyer queue is clean.
  {
    const ledger = LEDGER.testnet!;
    const vault = (await (await fetch(`${BASE}/api/earlypay/state`)).json()).vault as Hex;
    const [offers, decisions] = await Promise.all([fetchOffers(pub as PublicClient, ledger, LEDGER_FROM_BLOCK.testnet, vault), fetchDecisions(pub as PublicClient, ledger, LEDGER_FROM_BLOCK.testnet, vault)]);
    const latest = new Map(decisions.map(d => [d.offerHash.toLowerCase(), d.decision]));
    for (const o of offers.filter(x => /^(asha design studio|e2e-|test supplier)/i.test(x.meta.supplierName ?? '') && latest.get(x.offerHash.toLowerCase()) === 'ESCALATE')) {
      const prev = await pub.readContract({ address: ledger, abi: ledgerAbi, functionName: 'chainHead', args: [vault] }) as Hex;
      const inputs = { invoiceHash: o.offer.invoiceHash, by: 'owner', action: 'declined rehearsal invoice' };
      await pub.waitForTransactionReceipt({ hash: await ownerWallet.writeContract({ address: ledger, abi: ledgerAbi, functionName: 'recordDecision', args: [vault, o.offer.invoiceHash, o.offerHash, 3, inputsHash(inputs), prev, encodeNote({ reason: 'Owner declined a demo rehearsal invoice.', source: 'owner', inputs })] }) });
      console.log(`cleared ${o.meta.number}`);
    }
  }
  // Pre-stage (not recorded): the supplier registered earlier, so the 2-minute cooldown has passed.
  await relayRegister();
  const registeredAt = Date.now();
  const supplierInit = `try { localStorage.setItem('arcsteward.earlypay.supplierKey', '${supplierKey}'); localStorage.setItem('arcsteward.earlypay.profile', JSON.stringify({ name: '${SUPPLIER_NAME}', contact: '', payout: '${payout.address}', mode: 'own' })); } catch (e) {}`;

  await slideSection('title', slide(`<img class="coin" src="${BASE}/img/coin.png"><div class="k">Tameion Agents Hackathon · Arc + Circle</div><h1>ArcSteward<br><em>EarlyPay</em></h1><p>An AI treasury agent that pays supplier invoices early, only when it is worth it, through a vault it cannot break.</p>`), 'ArcSteward EarlyPay: AI early payments on Arc', 5000);
  await slideSection('problem', slide(`<div class="k">The problem</div><h2>Suppliers wait <em>60 days</em> to get paid.</h2><p>Buyers pay on 30–90 day terms. Small businesses and freelancers carry the gap, while the buyer's cash sits idle earning almost nothing.</p>`), 'Problem: suppliers wait months; buyers\' cash sits idle', 6000);
  await slideSection('pain', slide(`<div class="k">The pain</div><h2>Late, idle <em>and hijackable.</em></h2><div class="grid"><div><b>59%</b><span>of small businesses have invoices 30+ days overdue</span></div><div><b>~0%</b><span>earned on the buyer's idle cash meanwhile</span></div><div><b>$3.05B</b><span>lost to "our bank details changed" fraud (US, 2025). AI agents that pay bills are the next target.</span></div></div><div class="src">Sources as cited: QuickBooks Late Payments Report 2026; FBI IC3 2025.</div>`), 'Pain: overdue invoices, idle cash, payment-redirection fraud', 7500);
  await slideSection('solution', slide(`<div class="k">The solution</div><h2>An AI that pays early <em>only when it's worth it.</em></h2><div class="rows"><div><b>Decides</b><span>discount APR vs hold yield vs liquidity vs risk, and explains every decision</span></div><div><b>Can't overspend</b><span>the ArcSteward vault enforces per-payment, daily and total limits on-chain</span></div><div><b>Can't be redirected</b><span>two-key rule: supplier signs its payout; owner approves it; changes wait a cooldown</span></div><div><b>Auditable</b><span>every decision is hash-chained on Arc</span></div></div>`), 'Solution: AI treasury agent + on-chain limits + two-key supplier registry', 8500);
  await slideSection('why-arc', slide(`<div class="k">Why Arc and Circle</div><h2>"Paid today" has to mean <em>now.</em></h2><div class="rows"><div><b>Arc</b><span>sub-second settlement: early payment lands in seconds, not 3 bank days</span></div><div><b>USDC</b><span>payments and gas in one stable unit, ~a cent per payment</span></div><div><b>Vault limits</b><span>programmable authority the agent cannot be talked past</span></div><div><b>USYC · EURC</b><span>yield on idle cash (simulated on testnet) · euro suppliers (next)</span></div></div>`), 'Why Arc + Circle: instant USDC settlement, USDC gas, programmable limits', 7500);

  // Wait out the cooldown (not recorded).
  const wait = 125_000 - (Date.now() - registeredAt);
  if (wait > 0) { console.log(`… cooldown ${Math.round(wait / 1000)}s`); await new Promise(r => setTimeout(r, wait)); }

  const due = new Date(Date.now() + 60 * 86400e3).toISOString().slice(0, 10);
  await section('supplier-invoice', 1, { mobile: true, init: supplierInit }, async p => {
    await p.goto(`${BASE}/earlypay/supplier?buyer=Northwind`, { waitUntil: 'load' });
    await p.getByText(/Registered as/).first().waitFor({ timeout: 90_000 }); ready();
    await caption(p, 'Supplier on a phone: already registered, no gas', 2500);
    await p.locator('.card').nth(1).scrollIntoViewIfNeeded();
    await caption(p, 'Sends a 2 USDC invoice due in 60 days, 2% off for paying today');
    await type(p, p.getByLabel('Invoice number'), `${INV}-1`);
    await type(p, p.getByLabel('Amount (USDC)'), '2');
    await click(p, p.getByLabel('Due date')); await p.getByLabel('Due date').fill(due);
    await type(p, p.getByLabel('What is it for?'), 'Brand identity, phase 1');
    await p.locator('.calc').scrollIntoViewIfNeeded(); await p.waitForTimeout(2200);
    await caption(p, 'Signs the exact amount, discount and payout address');
    await click(p, p.getByRole('button', { name: /Sign & send/ }));
    await offCamera(() => p.getByText(new RegExp(`Invoice ${INV}-1 sent`)).first().waitFor({ timeout: 120_000 }));
    await p.getByText(new RegExp(`Invoice ${INV}-1 sent`)).first().scrollIntoViewIfNeeded();
    await caption(p, 'Invoice signed and sent to the buyer\'s treasury agent', 3000);
  });

  await section('buyer-escalate-approve', 2.4, { wallet: true }, async p => {
    await p.goto(`${BASE}/earlypay/buyer`, { waitUntil: 'load' });
    await p.getByText(/hash chain verified/).first().waitFor({ timeout: 90_000 }); ready();
    await caption(p, 'Buyer: the AI treasury agent and its on-chain limits', 2500);
    await click(p, p.getByRole('button', { name: 'Connect owner wallet' }));
    await offCamera(() => p.getByText(/· owner/).first().waitFor({ timeout: 60_000 }));
    await caption(p, 'Run the agent: it weighs APR, hold yield, liquidity and risk');
    for (let i = 0; i < 10; i++) {
      await click(p, p.getByRole('button', { name: /Run the agent now/ }));
      await offCamera(() => p.waitForFunction(() => ![...document.querySelectorAll('button')].some(b => /Agent deciding/.test(b.textContent ?? '')), undefined, { timeout: 180_000 }));
      if (await p.locator('.item', { hasText: `${INV}-1` }).filter({ hasText: 'ESCALATE' }).count()) break;
      await offCamera(() => p.waitForTimeout(3000));
    }
    const inv = p.locator('.item', { hasText: `${INV}-1` }).first();
    await move(p, inv);
    await caption(p, 'ESCALATE: 12.17% APR beats the hurdle, but this supplier is not approved yet', 4500);
    const card = p.locator('.item', { hasText: `${supplier.address.slice(0, 6)}…${supplier.address.slice(-4)}` }).first();
    await move(p, card);
    await caption(p, 'Two-key rule: the owner approves the supplier\'s own registered address', 2500);
    await click(p, card.getByRole('button', { name: 'Approve supplier' }));
    await offCamera(() => p.getByText(/Supplier approved on the vault/).first().waitFor({ timeout: 180_000 }));
    await caption(p, 'The agent re-decides and pays early from the vault');
    for (let i = 0; i < 12; i++) {
      if (await p.locator('.item', { hasText: `${INV}-1` }).filter({ hasText: 'PAID' }).count()) break;
      await click(p, p.getByRole('button', { name: /Run the agent now/ }));
      await offCamera(() => p.waitForFunction(() => ![...document.querySelectorAll('button')].some(b => /Agent deciding/.test(b.textContent ?? '')), undefined, { timeout: 180_000 }));
      await offCamera(() => p.waitForTimeout(4000));
    }
    await move(p, p.locator('.item', { hasText: `${INV}-1` }).first());
    await caption(p, 'PAID: 1.96 USDC settled on Arc in about a second', 4000);
    await p.locator('.stats').scrollIntoViewIfNeeded(); await caption(p, 'Savings dashboard from chain events', 2500);
  });

  await section('supplier-overlimit', 1, { mobile: true, init: supplierInit }, async p => {
    await p.goto(`${BASE}/earlypay/supplier?buyer=Northwind`, { waitUntil: 'load' });
    const paidRow = p.locator('.item', { hasText: `${INV}-1` }).filter({ hasText: 'PAID' }).first();
    await paidRow.waitFor({ timeout: 120_000 }); ready();
    await paidRow.scrollIntoViewIfNeeded(); await move(p, paidRow);
    await caption(p, 'The supplier sees PAID with the Arc payment link', 3500);
    await p.locator('.card').nth(1).scrollIntoViewIfNeeded();
    await caption(p, 'Next: a 5.5 USDC invoice, above the agent\'s 5 USDC per-payment limit');
    await type(p, p.getByLabel('Invoice number'), `${INV}-2`);
    await type(p, p.getByLabel('Amount (USDC)'), '5.5');
    await p.getByLabel('Due date').fill(due);
    await click(p, p.getByRole('button', { name: /Sign & send/ }));
    await offCamera(() => p.getByText(new RegExp(`Invoice ${INV}-2 sent`)).first().waitFor({ timeout: 120_000 }));
    await caption(p, 'Sent', 1500);
  });

  await section('buyer-human-approve', 2.2, { wallet: true }, async p => {
    await p.goto(`${BASE}/earlypay/buyer`, { waitUntil: 'load' });
    await p.getByText(/hash chain verified/).first().waitFor({ timeout: 90_000 }); ready();
    await click(p, p.getByRole('button', { name: 'Connect owner wallet' }));
    await offCamera(() => p.getByText(/· owner/).first().waitFor({ timeout: 60_000 }));
    for (let i = 0; i < 10; i++) {
      if (await p.locator('.item', { hasText: `${INV}-2` }).filter({ hasText: 'ESCALATE' }).count()) break;
      await click(p, p.getByRole('button', { name: /Run the agent now/ }));
      await offCamera(() => p.waitForFunction(() => ![...document.querySelectorAll('button')].some(b => /Agent deciding/.test(b.textContent ?? '')), undefined, { timeout: 180_000 }));
      await offCamera(() => p.waitForTimeout(3000));
    }
    const inv = p.locator('.item', { hasText: `${INV}-2` }).first();
    await move(p, inv);
    await caption(p, 'Over the per-payment limit: the agent escalates instead of paying', 4000);
    await caption(p, 'The owner pays from their own wallet; the agent\'s limits never move');
    await click(p, inv.getByRole('button', { name: /Approve & pay/ }));
    await offCamera(() => p.getByText(/from your wallet to the registered supplier/).first().waitFor({ timeout: 240_000 }));
    await move(p, p.locator('.notice').last());
    await caption(p, 'HUMAN_APPROVED recorded in the same on-chain log', 3500);
  });

  await section('audit', 1, {}, async p => {
    await p.goto(`${BASE}/earlypay/audit`, { waitUntil: 'load' });
    await p.getByText(/Hash chain verified in your browser/).first().waitFor({ timeout: 90_000 }); ready();
    await caption(p, 'Audit: every decision, its numbers and reason, hash-chained on Arc', 3000);
    await type(p, p.getByLabel(/Filter by invoice/), INV);
    await p.waitForTimeout(1500);
    await move(p, p.locator('.item').first());
    await caption(p, 'Recomputed in the browser: every link and hash verified', 4000);
    await p.mouse.wheel(0, 600); await p.waitForTimeout(2500);
  });

  await slideSection('architecture', slide(`<div class="k">Architecture</div><div style="margin-top:50px">${ARCH}</div>`), 'Architecture: signed offers go through a gasless relay to the ledger; the AI agent decides; the vault pays in USDC on Arc; every decision is auditable', 8500);
  await slideSection('end', slide(`<img class="coin" src="${BASE}/img/coin.png"><div class="k">ArcSteward EarlyPay</div><h2>Paid in seconds, <em>not 60 days.</em></h2><p>Live (Arc testnet): arcsteward.vercel.app/earlypay<br>Code: github.com/Lakshmikanth-3/ArcSteward<br>Contracts unchanged on mainnet · EarlyPayLedger on testnet · tests: e2e 14/14, live browser e2e</p>`), 'Thank you · arcsteward.vercel.app/earlypay', 5000);
  await browser.close();

  // Return the supplier's test USDC to the owner.
  const bal = await pub.getBalance({ address: payout.address });
  if (bal > parseEther('0.01')) await pub.waitForTransactionReceipt({ hash: await createWalletClient({ account: payout, chain: arcTestnet, transport }).sendTransaction({ to: owner.address, value: bal - parseEther('0.01') }) });

  // Assemble: each clip keeps [start, end] minus the off-camera waits, normalised to 1920x1080 @30fps
  // (phone clips centred on the parchment); clips are joined, subtitles burned in, narration mixed.
  const merge = (rs: [number, number][]) => rs.sort((a, b) => a[0] - b[0]).reduce<[number, number][]>((acc, r) => { const l = acc[acc.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else acc.push([...r]); return acc; }, []);
  const parts: string[] = [];
  const timed: (Cue & { at: number })[] = [];
  let offset = 0;
  clips.forEach((c, i) => {
    const cut = merge(c.idle.filter(([, b]) => b > c.start).map(([a, b]) => [Math.max(a, c.start), b] as [number, number]));
    const keep: [number, number][] = [];
    let cur = c.start;
    for (const [a, b] of cut) { if (a - cur > 0.05) keep.push([cur, a]); cur = Math.max(cur, b); }
    if (c.end - cur > 0.05) keep.push([cur, c.end]);
    const out = `${OUT}/raw/n${String(i).padStart(2, '0')}.mp4`;
    const segs = keep.map(([a, b], k) => `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS[s${k}]`).join(';');
    const fc = `${segs};${keep.map((_, k) => `[s${k}]`).join('')}concat=n=${keep.length}:v=1:a=0,fps=30,scale=-2:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0xefe7d8,format=yuv420p[v]`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', c.file, '-filter_complex', fc, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', out]);
    parts.push(out);
    const mapT = (t: number) => { let acc = 0; for (const [a, b] of keep) { if (t <= b) return acc + Math.max(0, t - a); acc += b - a; } return acc; };
    for (const q of cues.filter(q => q.clip === i)) timed.push({ ...q, at: offset + mapT(q.t) });
    offset += keep.reduce((sum, [a, b]) => sum + (b - a), 0);
  });
  writeFileSync(`${OUT}/raw/list.txt`, parts.map(f => `file '${f.split('/').pop()}'`).join('\n'));
  const joined = `${OUT}/raw/joined.mp4`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${OUT}/raw/list.txt`, '-c', 'copy', joined]);
  const total = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', joined]).toString());

  // Subtitles (SRT) from the narration timings.
  const ts = (x: number) => { const ms = Math.max(0, Math.round(x * 1000)); const h = Math.floor(ms / 3.6e6), m = Math.floor(ms / 6e4) % 60, s2 = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  const srt = timed.map((q, k) => { const next = timed[k + 1]?.at ?? total; return `${k + 1}\n${ts(q.at)} --> ${ts(Math.min(next - 0.05, q.at + q.dur + 0.8))}\n${q.text}\n`; }).join('\n');
  writeFileSync(`${OUT}/ArcSteward_EarlyPay_Demo.srt`, srt);

  // Burn subtitles and mix narration (each line delayed to its cue).
  const final = `${OUT}/ArcSteward_EarlyPay_Demo.mp4`;
  const audioIn = timed.flatMap(q => ['-i', q.wav]);
  const delays = timed.map((q, k) => `[${k + 1}:a]adelay=${Math.round(q.at * 1000)}|${Math.round(q.at * 1000)},aresample=48000[a${k}]`).join(';');
  const mix = `${delays};${timed.map((_, k) => `[a${k}]`).join('')}amix=inputs=${timed.length}:normalize=0,apad[a]`;
  const style = "Fontname=Arial,Fontsize=17,PrimaryColour=&H00F4EDE4,BackColour=&H90120C08,OutlineColour=&H90120C08,BorderStyle=3,Outline=6,Shadow=0,MarginV=34";
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', 'raw/joined.mp4', ...audioIn.map(a => a.startsWith(`${OUT}/`) ? a.slice(OUT.length + 1) : a),
    '-filter_complex', `[0:v]subtitles=ArcSteward_EarlyPay_Demo.srt:force_style='${style}'[v];${mix}`,
    '-map', '[v]', '-map', '[a]', '-t', total.toFixed(2), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', 'ArcSteward_EarlyPay_Demo.mp4'], { cwd: OUT });
  console.log(`\nVideo: ${final} · ${total.toFixed(1)} s · ${timed.length} narrated subtitles${total > 180 ? ' · WARNING: over 3 minutes' : ''}`);
}
main().catch(async e => { console.error(e); try { await browser?.close(); } catch { /* */ } process.exit(1); });
