'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, Info, History, LockKeyhole, Send, ShieldCheck, Wallet } from 'lucide-react';
import { createPublicClient, createWalletClient, custom, http, erc20Abi, keccak256, toHex, type Address, type EIP1193Provider, type Hash } from 'viem';
import { network, USDC, address, usdcAmount, displayUsdc } from '@/lib/arc/config';
import { vaultAbi, factoryAbi } from '@/lib/arc/abi';
import { paymentError } from '@/lib/arc/errors';

type Injected = EIP1193Provider & { on?: (event: string, listener: () => void) => void; removeListener?: (event: string, listener: () => void) => void };
const provider = () => (window as unknown as { ethereum?: Injected }).ethereum;
export default function ArcConsole({ networkName, rpcUrl, factoryAddress = '', initialVault = '', initialAgent = '' }: { networkName: 'mainnet' | 'testnet'; rpcUrl?: string; factoryAddress?: string; initialVault?: string; initialAgent?: string }) {
  const chain = network(networkName);
  const rpc = rpcUrl ?? chain.rpcUrls.default.http[0];
  const client = useMemo(() => createPublicClient({ chain, transport: http(rpc, { retryCount: 0, timeout: 15000 }) }), [chain, rpc]);
  const [factoryText, setFactoryText] = useState(factoryAddress);
  const [account, setAccount] = useState<Address>();
  const [connectedChain, setConnectedChain] = useState<number>();
  const [vault, setVault] = useState(initialVault);
  const [agent, setAgent] = useState(initialAgent);
  const [recipient, setRecipient] = useState('');
  const [recipients, setRecipients] = useState('');
  const [total, setTotal] = useState('1');
  const [perPayment, setPerPayment] = useState('0.1');
  const [expires, setExpires] = useState('');
  const [amount, setAmount] = useState('0.01');
  const [paymentId, setPaymentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Connect an EVM wallet to begin. Arc deployment status is unverified.');
  const [hash, setHash] = useState<Hash>();
  const [balance, setBalance] = useState<bigint>();
  const [owner, setOwner] = useState<Address>();
  const [policy, setPolicy] = useState<readonly [bigint, bigint, bigint, bigint, bigint, boolean]>();
  const [history, setHistory] = useState<{ hash: Hash; event: string; block: string; detail: string }[]>([]);
  const [historyFrom, setHistoryFrom] = useState<bigint>();
  useEffect(() => {
    const p = provider();
    const reset = () => { setAccount(undefined); setConnectedChain(undefined); setOwner(undefined); setVault(''); setBalance(undefined); setPolicy(undefined); setHistory([]); setHash(undefined); setMessage('Wallet changed. Reconnect to refresh account and network.'); };
    p?.on?.('accountsChanged', reset);
    p?.on?.('chainChanged', reset);
    return () => { p?.removeListener?.('accountsChanged', reset); p?.removeListener?.('chainChanged', reset); };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setHash(undefined); setMessage('Working… confirm any transaction in your wallet.');
    try { await action(); } catch (error) { setMessage(paymentError(error)); }
    finally { setBusy(false); }
  }
  async function signer() {
    const p = provider();
    if (!p || !account) throw new Error('Connect an injected EVM wallet');
    const wallet = createWalletClient({ chain, transport: custom(p) });
    const [current] = await wallet.getAddresses();
    if (current?.toLowerCase() !== account.toLowerCase()) throw new Error('Wallet account changed; reconnect');
    if (await wallet.getChainId() !== chain.id) throw new Error(`Switch wallet to ${chain.name} (${chain.id})`);
    if (await client.getChainId() !== chain.id) throw new Error('RPC network mismatch');
    return wallet;
  }
  async function validateVault() {
    const v = address(vault);
    if (!await client.getBytecode({ address: v })) throw new Error('Vault has no deployed bytecode');
    const token = await client.readContract({ address: v, abi: vaultAbi, functionName: 'usdc' });
    if (token.toLowerCase() !== USDC.toLowerCase()) throw new Error('Vault token is not Arc USDC');
    if (await client.readContract({ address: USDC, abi: erc20Abi, functionName: 'decimals' }) !== 6) throw new Error('USDC decimal mismatch');
    return v;
  }
  async function confirmed(tx: Hash) {
    setHash(tx); setMessage('Transaction submitted; waiting for confirmation…');
    const receipt = await client.waitForTransactionReceipt({ hash: tx, timeout: 90000 });
    if (receipt.status !== 'success') throw new Error(`Transaction reverted: ${tx}`);
    setMessage(`Confirmed in block ${receipt.blockNumber}`);
  }
  async function refresh(before?: bigint) {
    const v = await validateVault();
    const [b, o] = await Promise.all([client.readContract({ address: v, abi: vaultAbi, functionName: 'balance' }), client.readContract({ address: v, abi: vaultAbi, functionName: 'owner' })]);
    setBalance(b); setOwner(o);
    if (agent) setPolicy(await client.readContract({ address: v, abi: vaultAbi, functionName: 'capabilities', args: [address(agent)] }));
    const latest = before ?? await client.getBlockNumber({ cacheTime: 0 });
    const start = latest > 19999n ? latest - 19999n : 0n;
    const logs = [];
    for (let from = start; from <= latest; from += 5000n) {
      const to = from + 4999n < latest ? from + 4999n : latest;
      logs.push(...await client.getContractEvents({ address: v, abi: vaultAbi, fromBlock: from, toBlock: to }));
    }
    const rows = logs.reverse().map(log => ({ hash: log.transactionHash, block: String(log.blockNumber), event: log.eventName, detail: JSON.stringify(log.args, (_, value) => typeof value === 'bigint' ? String(value) : value) }));
    setHistory(old => before === undefined ? rows : [...old, ...rows]); setHistoryFrom(start);
  }
  async function mutate(fn: 'deposit' | 'withdraw' | 'revoke' | 'authorize' | 'pay') {
    const wallet = await signer();
    const v = await validateVault();
    let tx: Hash;
    if (fn === 'deposit') {
      const units = usdcAmount(amount);
      const { request } = await client.simulateContract({ account: account!, address: USDC, abi: erc20Abi, functionName: 'approve', args: [v, units] });
      await confirmed(await wallet.writeContract(request));
      const deposit = await client.simulateContract({ account: account!, address: v, abi: vaultAbi, functionName: 'deposit', args: [units] });
      tx = await wallet.writeContract(deposit.request);
    } else if (fn === 'withdraw') {
      const { request } = await client.simulateContract({ account: account!, address: v, abi: vaultAbi, functionName: fn, args: [usdcAmount(amount)] });
      tx = await wallet.writeContract(request);
    } else if (fn === 'revoke') {
      const { request } = await client.simulateContract({ account: account!, address: v, abi: vaultAbi, functionName: fn, args: [address(agent)] });
      tx = await wallet.writeContract(request);
    } else if (fn === 'authorize') {
      const seconds = Math.floor(Date.parse(expires) / 1000);
      if (!Number.isFinite(seconds) || seconds <= Date.now() / 1000) throw new Error('Choose a future expiry');
      const list = recipients.split(',').map(a => address(a.trim()));
      const { request } = await client.simulateContract({ account: account!, address: v, abi: vaultAbi, functionName: fn, args: [address(agent), usdcAmount(total), usdcAmount(perPayment), BigInt(seconds), list] });
      tx = await wallet.writeContract(request);
    } else {
      if (!paymentId.trim()) throw new Error('Enter a unique invoice/payment ID; reuse it when reconciling an uncertain result');
      const { request } = await client.simulateContract({ account: account!, address: v, abi: vaultAbi, functionName: fn, args: [address(recipient), usdcAmount(amount), keccak256(toHex(paymentId))] });
      tx = await wallet.writeContract(request);
    }
    await confirmed(tx); await refresh();
  }
  const isOwner = !!account && !!owner && account.toLowerCase() === owner.toLowerCase();
  const wrongChain = !!account && connectedChain !== chain.id;
  const field = (label: string, value: string, set: (s: string) => void, type = 'text') => <label className="arc-field">{label}<input type={type} value={value} onChange={e => set(e.target.value)} placeholder={type === 'text' && label.toLowerCase().includes('address') ? '0x…' : undefined} autoComplete="off" spellCheck={false} /></label>;
  const button = (label: string, action: () => Promise<void>, disabled = false, variant = '') => <button className={`btn ${variant}`} disabled={busy || disabled} onClick={() => void run(action)}>{label}</button>;
  return <div className="arc-console">
    <div className="arc-page-heading"><div><span className="arc-eyebrow">{networkName === 'testnet' ? 'DEVELOPMENT / LIVE TESTNET' : 'PAYMENTS / OWNER WORKSPACE'}</span><h1>Arc Agent Vault</h1><p>Owner funds. Agent pays. Contracts enforce the limits.</p></div><Link href="/submission" className="arc-badge warning">Mainnet evidence pending <ArrowUpRight size={13} /></Link></div>
    <div className="arc-notice"><AlertTriangle size={16} /><span>{networkName === 'testnet' ? 'Testnet only. Use free faucet USDC; these results do not satisfy the mainnet grant requirement.' : 'Experimental and unaudited. Verify the deployment before funding. Mainnet deployment and payment evidence are pending.'}</span></div>
    <div className="arc-stat-grid"><div className="arc-stat"><span>VAULT BALANCE</span><strong>{balance === undefined ? '—' : displayUsdc(balance)} <small>USDC available</small></strong><small>{balance === undefined ? 'Load state to read balance' : 'Available: ' + displayUsdc(balance) + ' USDC'}</small></div><div className="arc-stat"><span>AGENT CAPABILITY</span><strong>{policy ? policy[5] ? 'Active' : 'Revoked' : 'Not loaded'}</strong><small>{policy ? `Active: ${String(policy[5])}` : 'Owner-defined permissions'}</small></div><div className="arc-stat"><span>REMAINING BUDGET</span><strong>{policy ? displayUsdc(policy[0] - policy[2]) : '—'}</strong><small>{policy ? `Remaining: ${displayUsdc(policy[0] - policy[2])} USDC` : 'Lifetime budget less spending'}</small></div><div className="arc-stat"><span>PAYMENT NETWORK</span><strong>{networkName === 'testnet' ? 'Arc Testnet' : 'Arc Mainnet'}</strong><small>Chain {chain.id} · USDC</small></div></div>
    <div role="status" aria-live="polite" className="arc-status"><Info size={16} /><div>{message}{hash && <p><a href={`${chain.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">Transaction: {hash}</a></p>}</div></div>
    <div className="arc-console-grid"><div className="arc-panel-stack">
    <section id="arc-connect"><div className="arc-panel-head"><span className="arc-panel-icon"><Wallet size={18} /></span><div><h2>Connect your wallet</h2><p>01 / Your wallet signs every transaction</p></div></div><div className="arc-wallet-row"><span className="arc-badge">{account ? 'Connected' : 'Disconnected'}</span><span className="arc-address">{account ?? 'No wallet connected'}</span></div><div className="arc-actions">
      {button('Connect EVM wallet', async () => { const p = provider(); if (!p) throw new Error('Install an EVM wallet with an injected provider'); const w = createWalletClient({ chain, transport: custom(p) }); const [a] = await w.requestAddresses(); setAccount(a); setConnectedChain(await w.getChainId()); setMessage('Wallet connected. Switch network if needed, then load or create a vault.'); })}
      {wrongChain && button(`Switch to ${chain.name}`, async () => { const w = createWalletClient({ transport: custom(provider()!) }); try { await w.switchChain({ id: chain.id }); } catch { await w.addChain({ chain }); await w.switchChain({ id: chain.id }); } setMessage('Network changed. Reconnect your wallet.'); })}
    </div></section>
    <section id="arc-vault"><div className="arc-panel-head"><span className="arc-panel-icon"><LockKeyhole size={18} /></span><div><h2>Create or load vault</h2><p>02 / Fund a vault that you control</p></div></div><div className="arc-fields">
      {field('Factory address (verified deployment)', factoryText, setFactoryText)}
      {button('Create my vault', async () => { const w = await signer(); const f = address(factoryText); if (!await client.getBytecode({ address: f })) throw new Error('Factory not deployed'); if ((await client.readContract({ address: f, abi: factoryAbi, functionName: 'usdc' })).toLowerCase() !== USDC.toLowerCase()) throw new Error('Factory token mismatch'); const existing = await client.readContract({ address: f, abi: factoryAbi, functionName: 'vaultOf', args: [account!] }); if (!/^0x0{40}$/i.test(existing)) { setVault(existing); setMessage('Existing vault loaded; refresh to read its balance.'); return; } const { request } = await client.simulateContract({ account: account!, address: f, abi: factoryAbi, functionName: 'createVault' }); await confirmed(await w.writeContract(request)); setVault(await client.readContract({ address: f, abi: factoryAbi, functionName: 'vaultOf', args: [account!] })); }, !account || wrongChain || !factoryText)}
      {!factoryText && <p>Factory address is not configured. Deploy and configure a factory before creating vaults.</p>}
      {field('Vault address', vault, v => { setVault(v); setOwner(undefined); setBalance(undefined); setHistory([]); setPolicy(undefined); })}
      {button('Refresh on-chain state and history', async () => { await refresh(); setMessage('On-chain state refreshed'); }, !vault)}
      <dl className="arc-info-list"><div><dt>Vault owner</dt><dd className="arc-address">{owner ?? 'Load vault to inspect owner'}</dd></div></dl>
      {vault && <a href={`${chain.blockExplorers.default.url}/address/${vault}`} target="_blank" rel="noreferrer">Inspect vault on Arc Explorer</a>}
      {field('Deposit / withdrawal / payment amount (USDC)', amount, setAmount)}
      <div className="arc-actions">{button('Approve exact amount and deposit', () => mutate('deposit'), !isOwner || wrongChain)} {button('Withdraw to owner', () => mutate('withdraw'), !isOwner || wrongChain, 'secondary')}</div><p>Amounts use ERC-20 USDC with 6 decimals. Native gas uses 18 decimals. Only the loaded vault owner can deposit or withdraw.</p>
    </div></section></div><div className="arc-panel-stack">
    <section id="arc-revoke"><div className="arc-panel-head"><span className="arc-panel-icon"><ShieldCheck size={18} /></span><div><h2>Agent permissions</h2><p>03 / Define the boundaries before spending</p></div></div><div className="arc-fields">
      {field('Agent EVM address', agent, a => { setAgent(a); setPolicy(undefined); })}
      <div className="arc-field-pair">{field('Lifetime total budget (USDC)', total, setTotal)} {field('Maximum per payment (USDC)', perPayment, setPerPayment)}</div>
      {field('Permitted recipients (comma separated)', recipients, setRecipients)} {field('Expiry (your local time)', expires, setExpires, 'datetime-local')}
      <p>Updates preserve the amount already spent. Remaining budget is the total ceiling minus lifetime spending.</p>
      <div className="arc-actions">{button('Authorize / update', () => mutate('authorize'), !isOwner || wrongChain)} {button('Revoke immediately', () => mutate('revoke'), !isOwner || wrongChain, 'danger')}</div>
      {policy && <p>Spent: {displayUsdc(policy[2])} USDC · Expires: {new Date(Number(policy[3]) * 1000).toLocaleString()}</p>}
    </div></section>
    <section id="arc-payments"><div className="arc-panel-head"><span className="arc-panel-icon"><Send size={18} /></span><div><h2>Execute a payment</h2><p>04 / Sign with the authorized agent wallet</p></div></div><div className="arc-fields"><p>Connect the authorized agent wallet, load the vault and use a unique payment ID. A server agent can use the dedicated Arc SDK/CLI. Payment uses the USDC amount entered in the vault panel.</p>
      {field('Payment recipient', recipient, setRecipient)} {field('Unique invoice / payment ID', paymentId, setPaymentId)}
      {button('Pay USDC', () => mutate('pay'), !account || wrongChain || !vault)}
    </div></section></div></div>
    <section id="arc-history"><div className="arc-panel-head"><span className="arc-panel-icon"><History size={18} /></span><div><h2>Contract event history</h2><p>Confirmed activity, read directly from Arc</p></div></div><p>Actual logs only. Loaded from block {historyFrom === undefined ? 'unknown' : String(historyFrom)}; amounts in event details are six-decimal integer units.</p>
      {history.length === 0 ? <div className="arc-empty"><History size={24} /><strong>No events loaded</strong><p>Load a vault and refresh its on-chain state to inspect activity.</p></div> : history.map((row, i) => <div key={`${row.hash}-${i}`} className="arc-event"><a href={`${chain.blockExplorers.default.url}/tx/${row.hash}`} target="_blank" rel="noreferrer">{row.event} · block {row.block} ↗</a><pre>{row.detail}</pre></div>)}
      {historyFrom !== undefined && historyFrom > 0n && button('Load earlier events', () => refresh(historyFrom - 1n))}
    </section>
  </div>;
}
