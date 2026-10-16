// EarlyPay testnet setup (Arc TESTNET only). Creates dedicated relayer and agent keys
// in the git-ignored .env.local, funds them with testnet gas, creates a buyer vault for
// the owner, deposits USDC and authorizes the agent. Amounts are scaled down to fit
// faucet balances; the logic is identical at any size.
// Usage: tsx --env-file=.env.arc-testnet scripts/earlypay-testnet-setup.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, erc20Abi, parseEther, parseUnits, formatEther, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { network, USDC } from '../src/lib/arc/config';
import { factoryAbi, vaultAbi } from '../src/lib/arc/abi';
import dep from '../src/lib/arc/testnet-deployment.json';

const ENV = '.env.local';
const env = new Map<string, string>(existsSync(ENV) ? readFileSync(ENV, 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]) : []);
const save = () => writeFileSync(ENV, '# EarlyPay TESTNET signers (dedicated, disposable). Never use on mainnet. Never commit.\n' + [...env].map(([k, v]) => `${k}=${v}`).join('\n') + '\n');

async function main() {
  const chain = network('testnet');
  const transport = http(chain.rpcUrls.default.http[0], { timeout: 30000 });
  const pub = createPublicClient({ chain, transport });
  const owner = privateKeyToAccount(process.env.ARC_OWNER_PRIVATE_KEY as Hex);
  const ow = createWalletClient({ account: owner, chain, transport });
  const send = async (p: Promise<Hex>) => { const hash = await p; const r = await pub.waitForTransactionReceipt({ hash, timeout: 90000 }); if (r.status !== 'success') throw new Error(`tx ${hash} failed`); return hash; };
  for (const k of ['EARLYPAY_RELAYER_PRIVATE_KEY', 'EARLYPAY_AGENT_PRIVATE_KEY']) if (!env.get(k)) env.set(k, generatePrivateKey());
  save();
  const relayer = privateKeyToAccount(env.get('EARLYPAY_RELAYER_PRIVATE_KEY') as Hex);
  const agent = privateKeyToAccount(env.get('EARLYPAY_AGENT_PRIVATE_KEY') as Hex);
  const txs: Record<string, Hex> = {};
  for (const [name, who, want] of [['fundRelayer', relayer.address, '0.4'], ['fundAgent', agent.address, '0.3']] as const) {
    const have = await pub.getBalance({ address: who });
    if (have < parseEther(want) / 2n) txs[name] = await send(ow.sendTransaction({ to: who, value: parseEther(want) - have }));
  }
  // Resumable: reuse a vault from an earlier run (env, or the owner's latest empty-policy vault passed in EARLYPAY_VAULT).
  let vault = (env.get('EARLYPAY_VAULT') ?? process.env.EARLYPAY_VAULT) as Hex | undefined;
  if (!vault) {
    txs.createVault = await send(ow.writeContract({ address: dep.factory as Hex, abi: factoryAbi, functionName: 'createVault' }));
    const all = await pub.readContract({ address: dep.factory as Hex, abi: factoryAbi, functionName: 'vaultsOf', args: [owner.address] });
    vault = all[all.length - 1];
    env.set('EARLYPAY_VAULT', vault); save();
  }
  env.set('EARLYPAY_VAULT', vault); save();
  if (await pub.readContract({ address: vault, abi: vaultAbi, functionName: 'balance' }) === 0n) {
    const deposit = parseUnits(process.env.EARLYPAY_DEPOSIT_USDC ?? '3.5', 6);
    txs.approve = await send(ow.writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [vault, deposit] }));
    txs.deposit = await send(ow.writeContract({ address: vault, abi: vaultAbi, functionName: 'deposit', args: [deposit] }));
  }
  const cap = await pub.readContract({ address: vault, abi: vaultAbi, functionName: 'capabilities', args: [agent.address] });
  if (!cap[10]) {
    // The vault needs at least one recipient; the owner's own address is harmless. Suppliers are added with "Approve supplier".
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400);
    txs.authorize = await send(ow.writeContract({ address: vault, abi: vaultAbi, functionName: 'authorize', args: [agent.address, { maxTotal: parseUnits('3', 6), maxPayment: parseUnits('1', 6), maxPerDay: parseUnits('2.5', 6), gasAllowance: 0n, expiresAt, useRegistry: false }, [owner.address]] }));
  }
  env.set('NEXT_PUBLIC_EARLYPAY_VAULT', vault);
  env.set('NEXT_PUBLIC_EARLYPAY_AGENT', agent.address);
  save();
  const out = { chainId: chain.id, vault, owner: owner.address, agent: agent.address, relayer: relayer.address, policy: { maxTotalUSDC: '3', maxPaymentUSDC: '1', maxPerDayUSDC: '2.5', expiresDays: 7 }, transactions: txs, gas: { relayer: formatEther(await pub.getBalance({ address: relayer.address })), agent: formatEther(await pub.getBalance({ address: agent.address })) }, at: new Date().toISOString() };
  writeFileSync('../contracts/arc/deployments/5042002-earlypay-setup.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
