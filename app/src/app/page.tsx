import Link from 'next/link';
import { network } from '@/lib/arc/config';
import { projectDescription, builderProfileUrl } from '@/lib/arc/project';
import './landing.css';

const chain = network(process.env.NEXT_PUBLIC_ARC_NETWORK ?? 'mainnet');
const features = [
  { icon: 'account_balance_wallet', title: 'Owner-controlled USDC vault', description: 'Create a dedicated vault, fund it with USDC and withdraw available funds using your owner wallet.' },
  { icon: 'verified_user', title: 'Bounded agent capabilities', description: 'Set a lifetime budget, per-payment ceiling, recipient allowlist and expiry. The vault checks every payment.' },
  { icon: 'receipt_long', title: 'Payments with receipts', description: 'An authorized agent signs its payment. Inspect confirmed transaction hashes, remaining budget and contract events.' },
];

export default function LandingPage() {
  return <div className="arc-home">
    <nav className="arc-home-nav" aria-label="Main navigation">
      <Link href="/" className="arc-home-brand">Velo402 <span>on Arc</span></Link>
      <div className="arc-home-links"><Link href="/arc">Vault console</Link><Link href="#how-it-works">How it works</Link><Link href="/infrastructure">Infrastructure</Link></div>
      <Link href="/arc#arc-connect" className="arc-home-button secondary">Connect wallet ↗</Link>
    </nav>
    <main>
      <section className="arc-home-hero">
        <div className="arc-home-hero-copy">
          <div className="arc-home-eyebrow">USDC payments · capability-scoped agents</div>
          <h1>Give your agent a budget.<br /><span>Keep control on Arc.</span></h1>
          <p>Fund a USDC vault, authorize an agent and let smart contracts enforce who it can pay, how much it can spend and when its permission expires.</p>
          <div className="arc-home-actions"><Link href="/arc" className="arc-home-button">Open Arc vault ↗</Link><Link href="/infrastructure" className="arc-home-button secondary">Explore the infrastructure</Link></div>
          <p className="arc-home-status">Prototype · tested locally · mainnet deployment and public demo pending · unaudited</p>
        </div>
        <div className="arc-home-vault-visual" aria-label="Arc vault enforces agent payment limits">
          <div className="arc-home-visual-top"><span>VELO402 / ARC VAULT</span><span>POLICY ENGINE</span></div>
          <div className="arc-home-orb"><span className="material-symbols-outlined" aria-hidden="true">shield_lock</span></div>
          <h2>Permission before payment.</h2><div className="arc-home-checks"><span>Budget ceiling</span><span>Recipient allowlist</span><span>Expiry & revocation</span></div>
          <p>Architecture illustration · no live balances shown</p>
        </div>
      </section>
      <section className="arc-home-network" aria-label="Configured network">
        <div><span>Production target</span><strong>Arc Mainnet · 5042</strong></div><div><span>Payment asset</span><strong>USDC</strong></div><div><span>Wallet integration</span><strong>EVM · viem</strong></div><div><span>Console configuration</span><strong>{chain.name} · {chain.id}</strong></div>
      </section>
      <section className="arc-home-section" id="project-description"><div className="arc-home-eyebrow">Project description</div><h2>Velo402 · policy-enforced agent payments</h2><p>{projectDescription}</p><p>Deployment status: this description states the intended deployed behavior. Real mainnet deployment and payment evidence are still pending.</p><a href={builderProfileUrl} target="_blank" rel="noreferrer">Public builder profile ↗</a> · <Link href="/submission">View submission requirements and evidence</Link></section>
      <section className="arc-home-section" id="capabilities"><div className="arc-home-eyebrow">One vault. Clear boundaries.</div><h2>Built for agents that need to pay.</h2><div className="arc-home-feature-grid">{features.map(feature => <article className="arc-home-card" key={feature.title}><span className="material-symbols-outlined" aria-hidden="true">{feature.icon}</span><h3>{feature.title}</h3><p>{feature.description}</p></article>)}</div></section>
      <section className="arc-home-section" id="how-it-works"><div className="arc-home-eyebrow">The payment journey</div><h2>From owner funding to agent execution.</h2><div className="arc-home-steps">{[
        ['01', 'Connect & fund', 'Connect an EVM wallet to Arc, create a vault and deposit USDC.'],
        ['02', 'Grant a capability', 'Choose the agent address, permitted recipients, budget, payment limit and expiry.'],
        ['03', 'Execute & inspect', 'The agent signs a payment. The vault validates it and emits an on-chain receipt.'],
        ['04', 'Revoke when needed', 'The owner revokes the capability; subsequent agent payments are rejected.'],
      ].map(([number, title, detail]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{detail}</p></article>)}</div></section>
      <section className="arc-home-section arc-home-security"><div><div className="arc-home-eyebrow">Enforced in Solidity</div><h2>Your rules follow every payment.</h2><p>Authorization, spending limits, recipient permissions, expiration and duplicate payment IDs are checked by the vault. Owners retain withdrawal and revocation control.</p><p>Revocation takes effect after confirmation and cannot reverse a completed payment. This prototype has not received an independent security audit.</p><Link href="/arc#arc-revoke" className="arc-home-button secondary">Open revocation controls</Link></div><div className="arc-home-card"><h3>Arc infrastructure</h3><ul><li>Solidity vault and factory</li><li>USDC ERC-20 payment accounting</li><li>Dedicated agent SDK and signer</li><li>Real contract events and explorer links</li><li>OpenZeppelin transfer and reentrancy controls</li></ul><Link href="/infrastructure">View network and deployment details →</Link></div></section>
      <section className="arc-home-cta"><div className="arc-home-eyebrow">Start with a scoped capability</div><h2>Autonomous payments.<br />Owner-defined limits.</h2><Link href="/arc" className="arc-home-button">Open Arc console ↗</Link><p>Deployment configuration is required before sending real Arc transactions.</p></section>
    </main>
    <footer className="arc-home-footer"><span>© 2026 Velo402 · Arc Agent Vault</span><div><Link href="/infrastructure">Infrastructure & status</Link><a href="https://docs.arc.io/arc/references/connect-to-arc" target="_blank" rel="noreferrer">Arc documentation ↗</a><a href="https://github.com/Lakshmikanth-3/velo402" target="_blank" rel="noreferrer">Source repository ↗</a></div></footer>
  </div>;
}
