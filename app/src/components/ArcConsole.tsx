'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
  const field = (label: string, value: string, set: (s: string) => void, type = 'text') => <label style={{ display: 'grid', gap: 6 }}>{label}<input className="input" type={type} value={value} onChange={e => set(e.target.value)} style={{ padding: 10, border: '1px solid #555', borderRadius: 6, width: '100%' }} /></label>;
  const button = (label: string, action: () => Promise<void>, disabled = false) => <button className="btn" disabled={busy || disabled} onClick={() => void run(action)}>{label}</button>;
  return <div className="arc-console" style={{ display: 'grid', gap: 24, maxWidth: 1000 }}>
    <div><h1>Arc Agent Vault</h1><p>Owner funds. Agent pays. Contracts enforce the limits.</p><p>{chain.name} · Chain {chain.id} · ERC-20 USDC amounts use 6 decimals · gas uses 18 decimals</p><p>Experimental, unaudited. Mainnet readiness requires verified deployment, payment evidence and a working public link.</p><p><Link href="/arc">Production console</Link> · <Link href="/testnet">Arc Testnet console</Link> · <Link href="/submission">Submission readiness</Link></p>{networkName === 'testnet' && <p>TESTNET ONLY — use free faucet USDC. Testnet results do not satisfy the mainnet grant requirement.</p>}</div>
    <section id="arc-connect" style={{ display: 'grid', gap: 12 }}><h2>1. Connect wallet</h2><p>{account ?? 'Disconnected'}</p>
      {button('Connect EVM wallet', async () => { const p = provider(); if (!p) throw new Error('Install an EVM wallet with an injected provider'); const w = createWalletClient({ chain, transport: custom(p) }); const [a] = await w.requestAddresses(); setAccount(a); setConnectedChain(await w.getChainId()); setMessage('Wallet connected. Switch network if needed, then load or create a vault.'); })}
      {wrongChain && button(`Switch to ${chain.name}`, async () => { const w = createWalletClient({ transport: custom(provider()!) }); try { await w.switchChain({ id: chain.id }); } catch { await w.addChain({ chain }); await w.switchChain({ id: chain.id }); } setMessage('Network changed. Reconnect your wallet.'); })}
    </section>
    <section id="arc-vault" style={{ display: 'grid', gap: 12 }}><h2>2. Create or load vault</h2>
      {field('Factory address (verified deployment)', factoryText, setFactoryText)}
      {button('Create my vault', async () => { const w = await signer(); const f = address(factoryText); if (!await client.getBytecode({ address: f })) throw new Error('Factory not deployed'); if ((await client.readContract({ address: f, abi: factoryAbi, functionName: 'usdc' })).toLowerCase() !== USDC.toLowerCase()) throw new Error('Factory token mismatch'); const existing = await client.readContract({ address: f, abi: factoryAbi, functionName: 'vaultOf', args: [account!] }); if (!/^0x0{40}$/i.test(existing)) { setVault(existing); setMessage('Existing vault loaded; refresh to read its balance.'); return; } const { request } = await client.simulateContract({ account: account!, address: f, abi: factoryAbi, functionName: 'createVault' }); await confirmed(await w.writeContract(request)); setVault(await client.readContract({ address: f, abi: factoryAbi, functionName: 'vaultOf', args: [account!] })); }, !account || wrongChain || !factoryText)}
      {!factoryText && <p>Factory address is not configured. Deploy and configure a factory before creating vaults.</p>}
      {field('Vault address', vault, v => { setVault(v); setOwner(undefined); setBalance(undefined); setHistory([]); setPolicy(undefined); })}
      {button('Refresh on-chain state and history', async () => { await refresh(); setMessage('On-chain state refreshed'); }, !vault)}
      <p>Owner: {owner ?? 'Load vault'} · Available: {balance === undefined ? 'Unknown' : `${displayUsdc(balance)} USDC`}</p>
      {vault && <a href={`${chain.blockExplorers.default.url}/address/${vault}`} target="_blank" rel="noreferrer">Inspect vault on Arc Explorer</a>}
      {field('Deposit / withdrawal / payment amount (USDC)', amount, setAmount)}
      <div>{button('Approve exact amount and deposit', () => mutate('deposit'), !isOwner || wrongChain)} {button('Withdraw to owner', () => mutate('withdraw'), !isOwner || wrongChain)}</div>
    </section>
    <section id="arc-revoke" style={{ display: 'grid', gap: 12 }}><h2>3. Authorize or revoke agent</h2>
      {field('Agent EVM address', agent, a => { setAgent(a); setPolicy(undefined); })}
      {field('Lifetime total budget (USDC)', total, setTotal)} {field('Maximum per payment (USDC)', perPayment, setPerPayment)}
      {field('Permitted recipients (comma separated)', recipients, setRecipients)} {field('Expiry (your local time)', expires, setExpires, 'datetime-local')}
      <p>Updates preserve the amount already spent. Remaining budget is the total ceiling minus lifetime spending.</p>
      <div>{button('Authorize / update', () => mutate('authorize'), !isOwner || wrongChain)} {button('Revoke immediately', () => mutate('revoke'), !isOwner || wrongChain)}</div>
      {policy && <p>Active: {String(policy[5])} · Spent: {displayUsdc(policy[2])} USDC · Remaining: {displayUsdc(policy[0] - policy[2])} USDC · Expires: {new Date(Number(policy[3]) * 1000).toLocaleString()}</p>}
    </section>
    <section id="arc-payments" style={{ display: 'grid', gap: 12 }}><h2>4. Execute payment as connected agent</h2><p>Connect the authorized agent wallet, load the vault and use a unique payment ID. A server agent can use the dedicated Arc SDK/CLI.</p>
      {field('Payment recipient', recipient, setRecipient)} {field('Unique invoice / payment ID', paymentId, setPaymentId)}
      {button('Simulate and pay USDC', () => mutate('pay'), !account || wrongChain || !vault)}
    </section>
    <div role="status" aria-live="polite" style={{ overflowWrap: 'anywhere' }}>{message}{hash && <p><a href={`${chain.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">Transaction: {hash}</a></p>}</div>
    <section id="arc-history"><h2>Contract event history</h2><p>Actual logs only. Loaded from block {historyFrom === undefined ? 'unknown' : String(historyFrom)}; amounts in event details are six-decimal integer units.</p>
      {history.length === 0 ? <p>No events in the loaded window, or history has not been loaded.</p> : history.map((row, i) => <div key={`${row.hash}-${i}`} style={{ padding: 12, borderBottom: '1px solid #444', overflowWrap: 'anywhere' }}><a href={`${chain.blockExplorers.default.url}/tx/${row.hash}`} target="_blank" rel="noreferrer">{row.event} · block {row.block}</a><pre style={{ whiteSpace: 'pre-wrap' }}>{row.detail}</pre></div>)}
      {historyFrom !== undefined && historyFrom > 0n && button('Load earlier events', () => refresh(historyFrom - 1n))}
    </section>
  </div>;
}
