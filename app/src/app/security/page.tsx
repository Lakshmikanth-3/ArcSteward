import Link from 'next/link';
import { ArrowUpRight, Bug, FileCheck2, KeyRound, Lock, ShieldCheck, Workflow } from 'lucide-react';
import { repositoryUrl } from '@/lib/arc/project';
import deployment from '@/lib/arc/testnet-deployment.json';

const explorer = 'https://explorer.testnet.arc.io/tx/';

// Each row: what a manipulated agent tries, the contract rule that stops it, and the test that proves it.
const attacks = [
  ['Spend more than one payment allows', 'amount > maxPayment → PaymentLimit', 'Contract · Adversarial · Testnet'],
  ['Drain the vault over many payments', 'spent + amount > maxTotal → TotalLimit', 'Contract · Adversarial · Testnet'],
  ['Pay itself or an attacker address', 'recipient not on owner allowlist → RecipientDenied', 'Contract · Adversarial · Testnet'],
  ['Replay an earlier payment', 'paymentId already used → DuplicatePayment', 'Contract · Adversarial · Testnet'],
  ['Keep paying after permission ends', 'block.timestamp ≥ expiresAt → Expired', 'Contract · Adversarial · Testnet'],
  ['Keep paying after the owner revokes', 'active = false → Unauthorized', 'Contract · Adversarial · Testnet'],
  ['Raise its own limits', 'authorize() is onlyOwner → NotOwner', 'Adversarial · Testnet'],
  ['Withdraw the vault balance', 'withdraw() is onlyOwner, pays owner only', 'Adversarial · Testnet'],
  ['Cancel the owner’s revocation', 'revoke()/authorize() are onlyOwner', 'Adversarial · Testnet'],
  ['Spend too fast after a key theft', 'daySpent + amount > maxPerDay → DailyLimit', 'Contract · Adversarial · Testnet'],
  ['Drain through the gas allowance', 'gasSpent + amount > gasAllowance → GasLimit', 'Contract · Adversarial · Testnet'],
  ['Add itself or an attacker as recipient', 'setRecipient()/setRegistry() are onlyOwner', 'Contract · Adversarial · Testnet'],
  ['Follow a prompt injection in fetched content', 'Injected pay() to an unlisted address → RecipientDenied', 'AI agent run · Testnet'],
  ['Re-enter during a transfer', 'ReentrancyGuard on every state-changing call', 'Contract'],
  ['Reuse an old recipient list', 'Allowlist is versioned; each update starts fresh', 'Contract'],
] as const;

export default function SecurityPage() {
  const tx = (deployment.e2e?.transactions ?? {}) as Record<string, string>;
  return <div className="arc-console">
    <div className="arc-page-heading"><div><span className="arc-eyebrow">SECURITY / AGENT CANNOT BE MANIPULATED</span><h1>The contract decides. Not the agent.</h1><p>Assume the AI is prompt-injected or its key is stolen. It still cannot move a cent outside the owner’s policy.</p></div><span className="arc-badge">All checks passing</span></div>
    <div className="arc-stat-grid">
      <div className="arc-stat"><span>ATTACK CLASSES</span><strong>{attacks.length}</strong><small>Each blocked on-chain</small></div>
      <div className="arc-stat"><span>ADVERSARIAL ROUNDS</span><strong>300 × seeds</strong><small>Random attacks, invariant after each</small></div>
      <div className="arc-stat"><span>LIVE TESTNET E2E</span><strong>14 / 14</strong><small>Real Arc transactions</small></div>
      <div className="arc-stat"><span>AGENT POWERS</span><strong>2 functions</strong><small>pay() and topUpGas(), both bounded</small></div>
    </div>
    <div className="arc-info-grid">
      <section className="full-width"><div className="arc-panel-head"><span className="arc-panel-icon"><Bug size={18} /></span><div><h2>Threat model</h2><p>What a compromised agent tries, and what stops it</p></div></div><div className="arc-table-wrap"><table><thead><tr><th>Attack</th><th>On-chain defense in ArcVault.sol</th><th>Proven by</th></tr></thead><tbody>
        {attacks.map(([attack, defense, proof]) => <tr key={attack}><td>{attack}</td><td className="mono">{defense}</td><td><span className="arc-badge">{proof}</span></td></tr>)}
      </tbody></table></div></section>
      <section><div className="arc-panel-head"><span className="arc-panel-icon"><KeyRound size={18} /></span><div><h2>Why it holds</h2><p>Trust lives in the contract</p></div></div><ol className="arc-flow">
        <li><span>The agent key can only call <code>pay()</code> and <code>topUpGas()</code>, both bounded by the owner&apos;s policy. Every owner function checks <code>msg.sender == owner</code>.</span></li>
        <li><span>Every rule is checked inside the same transaction that moves USDC. A failed check reverts and moves nothing.</span></li>
        <li><span>The SDK and UI pre-check a payment before signing, but they are a convenience. The contract is the authority.</span></li>
        <li><span>Budget spent is stored on-chain and survives re-authorization, so limits cannot be reset by the agent.</span></li>
        <li><span>The contracts are immutable: no admin key, no upgrade path, no owner change.</span></li>
      </ol></section>
      <div className="arc-panel-stack">
        <section><div className="arc-panel-head"><span className="arc-panel-icon"><Workflow size={18} /></span><div><h2>Adversarial invariant test</h2><p>scripts/arc-adversarial.test.mjs</p></div></div><p>A simulated attacker sends hundreds of random transactions: oversized amounts, foreign recipients, replayed IDs, owner-only calls, time jumps, revocations. After every round the test checks that on-chain spend equals the sum of permitted payments, never exceeds the budget, and the attacker and agent hold zero USDC.</p></section>
        <section><div className="arc-panel-head"><span className="arc-panel-icon"><FileCheck2 size={18} /></span><div><h2>Live Arc testnet receipts</h2><p>From the latest end-to-end run</p></div></div><dl className="arc-info-list">
          {(['createVault', 'deposit', 'authorize', 'pay', 'revoke', 'withdraw'] as const).filter(k => tx[k]).map(k => <div key={k}><dt>{k}</dt><dd><a href={explorer + tx[k]} target="_blank" rel="noreferrer">{tx[k].slice(0, 10)}…{tx[k].slice(-6)} ↗</a></dd></div>)}
        </dl></section>
      </div>
      <section className="full-width"><div className="arc-panel-head"><span className="arc-panel-icon"><Lock size={18} /></span><div><h2>Verify it yourself</h2><p>Every claim on this page is reproducible</p></div></div><div className="arc-table-wrap"><table><tbody>
        <tr><td className="mono">pnpm arc:test</td><td>Contract flow + adversarial invariant test on a local EVM</td></tr>
        <tr><td className="mono">pnpm arc:testnet:e2e</td><td>Fresh owner, agent and vault on Arc testnet; 14 checks with real transactions</td></tr>
        <tr><td className="mono">ARC_FUZZ_SEED=7 pnpm arc:test</td><td>Re-run the attacker with a different random seed</td></tr>
      </tbody></table></div><div className="arc-actions" style={{ marginTop: 18 }}><a className="btn" href={`${repositoryUrl}/blob/main/contracts/arc/ArcVault.sol`} target="_blank" rel="noreferrer">Read ArcVault.sol <ArrowUpRight size={14} /></a><Link href="/testnet" className="btn secondary">Inspect the testnet vault</Link><Link href="/arc" className="btn secondary"><ShieldCheck size={14} /> Open vault workspace</Link></div></section>
    </div>
  </div>;
}
