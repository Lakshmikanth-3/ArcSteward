import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, http, decodeEventLog, encodeDeployData, keccak256 } from 'viem';
import { arcMainnet, arcTestnet, USDC, address } from '../src/lib/arc/config';
import { builderProfileUrl, projectDescription } from '../src/lib/arc/project';
import { vaultAbi, factoryAbi } from '../src/lib/arc/abi';

// Independent read-only proof checks. Local build success is never an eligibility signal.
async function main() {
  const testnet = process.argv.includes('--testnet');
  const chain = testnet ? arcTestnet : arcMainnet;
  const results: { check: string; status: 'PASS' | 'MISSING' | 'FAIL' | 'MANUAL'; detail: string }[] = [];
  results.push({ check: 'Local checks', status: 'MANUAL', detail: 'Run arc:test, test, typecheck, lint and build. Consult ARC_EXECUTION_REPORT.md for results actually executed.' });
  let evidence: { factory?: string; vault?: string; deploymentHash?: `0x${string}`; paymentHash?: `0x${string}`; liveUrl?: string; builderProfile?: string } = {};
  try { evidence = JSON.parse(readFileSync(testnet ? '../docs/arc-testnet-evidence.json' : '../docs/arc-evidence.json', 'utf8')); } catch { /* Missing evidence stays missing. */ }
  const p = createPublicClient({ chain, transport: http(testnet ? arcTestnet.rpcUrls.default.http[0] : process.env.ARC_RPC_URL ?? arcMainnet.rpcUrls.default.http[0], { retryCount: 0, timeout: 15000 }) });
  if (process.argv.includes('--online')) {
    try {
      if (await p.getChainId() !== chain.id) throw new Error('RPC mismatch');
      results.push({ check: testnet ? 'Testnet RPC' : 'Mainnet RPC', status: 'PASS', detail: `eth_chainId = ${chain.id}` });
      if (evidence.factory && evidence.deploymentHash) {
        const factory = address(evidence.factory);
        const receipt = await p.getTransactionReceipt({ hash: evidence.deploymentHash });
        const tx = await p.getTransaction({ hash: evidence.deploymentHash });
        const artifact = JSON.parse(readFileSync('../contracts/arc/artifacts/ArcVaultFactory.json', 'utf8'));
        const expected = encodeDeployData({ abi: factoryAbi, bytecode: artifact.bytecode, args: [USDC] });
        if (receipt.status !== 'success' || receipt.contractAddress?.toLowerCase() !== factory.toLowerCase() || tx.input !== expected || tx.to !== null) throw new Error('Factory deployment receipt/source mismatch');
        const code = await p.getBytecode({ address: factory });
        if (!code || code === '0x') throw new Error('Factory bytecode missing');
        if ((await p.readContract({ address: factory, abi: factoryAbi, functionName: 'usdc' })).toLowerCase() !== USDC.toLowerCase()) throw new Error('Factory token mismatch');
        results.push({ check: 'Factory deployment', status: 'PASS', detail: `${factory}; creation input matches local compiler artifact; runtime ${keccak256(code)}` });
      } else results.push({ check: 'Factory deployment', status: 'MISSING', detail: 'Supply actual factory and deployment hash' });
      if (evidence.vault && evidence.paymentHash && evidence.factory) {
        const vault = address(evidence.vault);
        const owner = await p.readContract({ address: vault, abi: vaultAbi, functionName: 'owner' });
        const registered = await p.readContract({ address: address(evidence.factory), abi: factoryAbi, functionName: 'vaultOf', args: [owner] });
        if (registered.toLowerCase() !== vault.toLowerCase()) throw new Error('Vault not registered in factory');
        if ((await p.readContract({ address: vault, abi: vaultAbi, functionName: 'usdc' })).toLowerCase() !== USDC.toLowerCase()) throw new Error('Vault token mismatch');
        const receipt = await p.getTransactionReceipt({ hash: evidence.paymentHash });
        if (receipt.status !== 'success') throw new Error('Payment reverted');
        const event = receipt.logs.filter(l => l.address.toLowerCase() === vault.toLowerCase()).map(l => { try { return decodeEventLog({ abi: vaultAbi, ...l }); } catch { return null; } }).find(e => e?.eventName === 'Paid');
        if (!event || event.eventName !== 'Paid' || event.args.amount <= 0n) throw new Error('Successful Paid event missing');
        results.push({ check: testnet ? 'Real testnet payment' : 'Real mainnet payment', status: 'PASS', detail: JSON.stringify(event.args, (_, v) => typeof v === 'bigint' ? String(v) : v) });
      } else results.push({ check: testnet ? 'Real testnet payment' : 'Real mainnet payment', status: 'MISSING', detail: 'Supply actual vault and payment receipt hash' });
    } catch { results.push({ check: 'On-chain verification', status: 'FAIL', detail: 'RPC or evidence validation failed. No deployment readiness claim.' }); }
    if (evidence.liveUrl) {
      try { const url = new URL(evidence.liveUrl); if (url.protocol !== 'https:' || /localhost|127\.0\.0\.1|example\./i.test(url.hostname)) throw new Error('Public HTTPS URL required'); const response = await fetch(url, { signal: AbortSignal.timeout(15000) }); const page = await response.text(); if (!response.ok || !page.includes('Arc Agent Vault')) throw new Error('Console page unavailable'); results.push({ check: 'Public live URL responds', status: 'PASS', detail: url.toString() }); } catch { results.push({ check: 'Public live URL responds', status: 'FAIL', detail: 'Live Arc console could not be verified' }); }
    } else results.push({ check: 'Public live URL', status: 'MISSING', detail: 'Deploy frontend and provide working /arc URL' });
  } else results.push({ check: 'Online proofs', status: 'MISSING', detail: 'Run with --online after supplying real evidence' });
  const profile = evidence.builderProfile ?? builderProfileUrl;
  if (process.argv.includes('--online')) {
    try { const response = await fetch(profile, { signal: AbortSignal.timeout(15000) }); results.push({ check: 'Public builder profile', status: response.ok ? 'PASS' : 'FAIL', detail: profile }); } catch { results.push({ check: 'Public builder profile', status: 'FAIL', detail: profile }); }
    try {
      const response = await fetch('https://raw.githubusercontent.com/Lakshmikanth-3/velo-arc/main/contracts/arc/ArcVault.sol', { signal: AbortSignal.timeout(15000) });
      const remote = (await response.text()).replace(/\r\n/g, '\n');
      const local = readFileSync('../contracts/arc/ArcVault.sol', 'utf8').replace(/\r\n/g, '\n');
      results.push({ check: 'Current Arc source published', status: response.ok && remote === local ? 'PASS' : 'MISSING', detail: 'Public repository must contain this Arc implementation, not just the previous Sui baseline.' });
    } catch { results.push({ check: 'Current Arc source published', status: 'FAIL', detail: 'Public Arc source could not be verified' }); }
  } else results.push({ check: 'Public builder profile', status: 'MANUAL', detail: profile });
  results.push({ check: 'Short project description', status: 'PASS', detail: projectDescription });
  results.push({ check: 'Prior Circle/Arc funding', status: 'PASS', detail: 'Project owner confirmed no prior funding in this chat on 2026-10-14; self-reported declaration.' });
  results.push({ check: 'Submission rights, duplicate submission and payout screening', status: 'MANUAL', detail: 'Builder must satisfy the supplied program rules and select a secure mainnet payout wallet.' });
  if (testnet) results.push({ check: 'Mainnet eligibility', status: 'MISSING', detail: 'Testnet proof never satisfies the working-mainnet requirement.' });
  results.push({ check: 'Reviewer journey and program requirements', status: 'MANUAL', detail: 'Verify full wallet flow at live URL and current DoraHacks requirements. HTTP response or compilation is insufficient.' });
  console.log(JSON.stringify({ eligible: false, explanation: 'Eligibility is never inferred from compilation or automated evidence alone.', results }, null, 2));
  writeFileSync(testnet ? '../docs/ARC_TESTNET_READINESS.json' : '../docs/ARC_READINESS.json', JSON.stringify({ eligible: false, chainId: chain.id, checkedAt: new Date().toISOString(), results }, null, 2));
  process.exitCode = 1; // Deliberately incomplete until manual review and submission evidence exist.
}
main().catch(() => { console.error('Readiness failed; no eligibility claim'); process.exitCode = 1; });
