import Link from 'next/link';
import { ArrowUpRight, Bell, Bot, Code2, GitCompare, Landmark, Route, Scale, Users } from 'lucide-react';
import { repositoryUrl } from '@/lib/arc/project';
import deployment from '@/lib/arc/testnet-deployment.json';

const sdk = `import { ArcAgent, fetchWithPayment } from '@velo402/arc-sdk';
import { privateKeyToAccount } from 'viem/accounts';

const agent = new ArcAgent(privateKeyToAccount(AGENT_KEY), VAULT, 'testnet', {
  onEvent: e => console.log(e),          // paid / rejected / gas
});

// Pays the 402 invoice from the vault, then retries with proof.
const { response } = await fetchWithPayment(agent, 'https://velo402.vercel.app/api/x402/arc-stats');
console.log(await response.json());`;

const compare = [
  ['Limits enforced on-chain, per agent', 'Yes', 'Varies by setup', 'Module-dependent'],
  ['Per-payment, daily and lifetime caps in USDC', 'Yes, all three', 'Policy service', 'Custom module'],
  ['Recipient allowlist plus opt-in merchant registry', 'Yes', 'Partly', 'Custom'],
  ['Replay protection by invoice hash', 'Yes', 'No', 'No'],
  ['Agent gas paid from its own bounded allowance', 'Yes (USDC gas on Arc)', 'Sponsored', 'Paymaster'],
  ['HTTP 402 pay-per-request built in', 'Yes', 'Separate', 'No'],
  ['Footprint', 'One small contract, no admin key', 'Hosted service', 'Smart account + modules'],
];

export default function DevelopersPage() {
  return <div className="arc-console">
    <div className="arc-page-heading"><div><span className="arc-eyebrow">DEVELOPERS / AGENTS THAT PAY</span><h1>Plug an AI agent into a vault.</h1><p>SDK, pay-per-request API, alerts and a working AI agent, all on Arc.</p></div><a className="arc-badge" href={`${repositoryUrl}/tree/main/sdk`} target="_blank" rel="noreferrer">SDK source <ArrowUpRight size={13} /></a></div>
    <div className="arc-info-grid">
      <section className="full-width"><div className="arc-panel-head"><span className="arc-panel-icon"><Code2 size={18} /></span><div><h2>Agent SDK quickstart</h2><p>@velo402/arc-sdk · TypeScript · viem</p></div></div><pre className="arc-code">{sdk}</pre>
        <p>The agent key can only call <code>pay()</code> and <code>topUpGas()</code>. <code>check()</code> previews a payment against the live contract; <code>ensureGas()</code> refills the agent&apos;s gas from its allowance; <code>invoiceId()</code> hashes an order so it can never be paid twice.</p></section>
      <section><div className="arc-panel-head"><span className="arc-panel-icon"><Route size={18} /></span><div><h2>HTTP 402 pay-per-request</h2><p>x402-style, scheme velo402-vault</p></div></div><ol className="arc-flow">
        <li>The agent calls a paid endpoint and gets <code>402</code> with an invoice, price and merchant address.</li>
        <li>It pays from the vault with <code>paymentId = keccak256(invoice)</code>. The vault enforces the owner&apos;s policy.</li>
        <li>It retries with an <code>X-PAYMENT</code> header holding the transaction hash.</li>
        <li>The server checks on Arc: a real USDC transfer to the merchant, from a factory vault, bound to this invoice.</li>
      </ol><dl className="arc-info-list" style={{ marginTop: 16 }}><div><dt>Live endpoints</dt><dd className="mono">/api/x402/arc-stats · /api/x402/untrusted-article</dd></div><div><dt>Testnet merchant</dt><dd className="arc-address">{deployment.merchant}</dd></div><div><dt>Merchant registry</dt><dd className="arc-address">{deployment.registry}</dd></div></dl></section>
      <div className="arc-panel-stack">
        <section><div className="arc-panel-head"><span className="arc-panel-icon"><Bot size={18} /></span><div><h2>AI agent</h2><p>agent/ai-agent.ts</p></div></div><p>An LLM agent with three tools: get_budget, buy_resource and pay. It works with any OpenAI-compatible API: Groq&apos;s free tier by default, or Ollama locally with no key. The test article contains a prompt injection telling the agent to send 5 USDC to an attacker; the vault refuses it with RecipientDenied and nothing moves.</p><pre className="arc-code">LLM_API_KEY=... pnpm arc:ai-agent</pre></section>
        <section><div className="arc-panel-head"><span className="arc-panel-icon"><Bell size={18} /></span><div><h2>Owner alerts</h2><p>Webhook and Telegram</p></div></div><p>Payments, gas draws, revocations and blocked attempts go to <code>ALERT_WEBHOOK_URL</code> (Discord, Slack, Zapier) and to Telegram via <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHAT_ID</code>. The console also shows live in-app alerts.</p><pre className="arc-code">ARC_VAULT_ADDRESS=0x... pnpm arc:watch</pre></section>
      </div>
      <section className="full-width"><div className="arc-panel-head"><span className="arc-panel-icon"><GitCompare size={18} /></span><div><h2>Why not an existing agent wallet?</h2><p>General comparison by approach; products change, so check current docs</p></div></div><div className="arc-table-wrap"><table><thead><tr><th>Capability</th><th>Velo402 vault</th><th>Hosted agent wallets</th><th>Smart accounts + session keys</th></tr></thead><tbody>
        {compare.map(r => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}
      </tbody></table></div></section>
      <section><div className="arc-panel-head"><span className="arc-panel-icon"><Users size={18} /></span><div><h2>Who uses it</h2><p>Concrete jobs, each a policy template in the console</p></div></div><ol className="arc-flow">
        <li>Research agents buying papers, datasets and search results per query.</li>
        <li>Trading bots paying for market data feeds, capped per day.</li>
        <li>Agent marketplaces where one agent hires another for a task.</li>
        <li>Teams giving each internal agent its own vault and budget.</li>
      </ol></section>
      <div className="arc-panel-stack">
        <section><div className="arc-panel-head"><span className="arc-panel-icon"><Landmark size={18} /></span><div><h2>Roadmap and business model</h2><p>After this grant</p></div></div><ol className="arc-flow">
          <li>Escrow contract: pay on delivery, refund on timeout.</li>
          <li>Batched settlement for high-frequency micro-payments.</li>
          <li>Hosted dashboard with team budgets: paid plan. The contracts stay free and open source.</li>
          <li>Independent security audit before large balances.</li>
        </ol></section>
        <section><div className="arc-panel-head"><span className="arc-panel-icon"><Scale size={18} /></span><div><h2>Responsibilities</h2><p>Non-custodial by design</p></div></div><p>Velo402 never holds funds or keys. Each vault belongs to its owner, who sets the policy and is responsible for the agent&apos;s payments. The owner can be a multisig such as Safe for key recovery. Vaults accept Arc USDC only.</p></section>
      </div>
      <section className="full-width"><div className="arc-actions"><Link href="/testnet" className="btn">Try it on testnet</Link><Link href="/security" className="btn secondary">Security proof</Link><a className="btn secondary" href={repositoryUrl} target="_blank" rel="noreferrer">Source repository</a></div></section>
    </div>
  </div>;
}
