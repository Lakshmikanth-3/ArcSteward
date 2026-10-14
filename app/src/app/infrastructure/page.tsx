import Link from 'next/link';
import { network, arcMainnet, arcTestnet, USDC } from '@/lib/arc/config';

export default function InfrastructurePage() {
  const configured = network(process.env.NEXT_PUBLIC_ARC_NETWORK ?? 'mainnet');
  const factoryConfigured = Boolean(process.env.NEXT_PUBLIC_ARC_FACTORY_ADDRESS);
  return <div className="arc-console" style={{ display: 'grid', gap: 24, maxWidth: 1000 }}>
    <div><p>VELO402 / INFRASTRUCTURE</p><h1>Built around Arc and USDC</h1><p>The vault, wallet console and dedicated agent SDK share one Arc execution path.</p></div>
    <section><h2>Network configuration</h2><p>Current console target: {configured.name} · {configured.id}</p><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>Parameter</th><th>Arc Mainnet</th><th>Arc Testnet</th></tr></thead><tbody>
      <tr><td>Chain ID</td><td>{arcMainnet.id}</td><td>{arcTestnet.id}</td></tr>
      <tr><td>Official RPC</td><td>{arcMainnet.rpcUrls.default.http[0]}</td><td>{arcTestnet.rpcUrls.default.http[0]}</td></tr>
      <tr><td>Explorer</td><td><a href={arcMainnet.blockExplorers.default.url}>Arc Explorer</a></td><td><a href={arcTestnet.blockExplorers.default.url}>Arc Testnet Explorer</a></td></tr>
      <tr><td>Gas currency</td><td>Native USDC</td><td>Native USDC</td></tr>
    </tbody></table></div></section>
    <section><h2>One USDC balance, two interfaces</h2><p>Vault deposits, payments and budgets use the USDC ERC-20 interface at <code style={{ overflowWrap: 'anywhere' }}>{USDC}</code>, with 6 decimals. Native gas uses 18 decimals. These are views of the same underlying balance and are never added together.</p></section>
    <section><h2>Execution architecture</h2><ol><li>Owner wallet creates and funds its dedicated vault.</li><li>Owner grants an agent a capability with limits, recipients and expiry.</li><li>Agent wallet or dedicated server signer submits the payment.</li><li>Solidity validates the capability and transfers USDC.</li><li>The console and SDK read receipts, remaining budget and contract events.</li></ol><p>OpenZeppelin SafeERC20 and ReentrancyGuard protect transfer handling. The contracts are immutable and unaudited.</p></section>
    <section><h2>Deployment status</h2><p>{factoryConfigured ? 'A factory address is configured; configuration alone does not verify a working deployment.' : 'A factory address has not been configured. Deploy and verify a factory before creating a real Arc vault.'}</p><p>Mainnet deployment, a real mainnet payment, source verification and a public demo have not been verified in this local project. Local tests and build success do not establish grant eligibility.</p><Link href="/arc" className="btn">Open vault console</Link></section>
    <section><h2>Official references</h2><p><a href="https://docs.arc.io/arc/references/connect-to-arc" target="_blank" rel="noreferrer">Network setup</a> · <a href="https://docs.arc.io/arc/references/contract-addresses" target="_blank" rel="noreferrer">USDC interface</a></p></section>
  </div>;
}
