import Link from 'next/link';
import { projectDescription, repositoryUrl, builderProfileUrl } from '@/lib/arc/project';
import demo from '@/lib/arc/testnet-demo.json';

export default function SubmissionPage() {
  return <div className="arc-console" style={{ display: 'grid', gap: 24, maxWidth: 1000 }}>
    <div><h1>Arc Microgrants readiness</h1><p>Not eligible for submission yet. The program requires a working Arc mainnet deployment; testnet-only builds do not qualify.</p></div>
    <section><h2>Project description</h2><p>{projectDescription}</p><p>This is the submission description for the deployed application. Mainnet evidence remains pending.</p></section>
    <section><h2>Required evidence</h2><table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>Requirement</th><th>Current status</th></tr></thead><tbody>
      <tr><td>Working Arc mainnet app with public live link</td><td>Missing — localhost is not a public deployment</td></tr>
      <tr><td>Public source repository</td><td><a href={repositoryUrl}>Repository available</a>; current Arc changes need publishing</td></tr>
      <tr><td>Short project description and Arc usage</td><td>Added above</td></tr>
      <tr><td>Public builder profile</td><td><a href={builderProfileUrl}>GitHub builder profile</a></td></tr>
      <tr><td>No prior Circle/Arc funding</td><td>Confirmed by project owner on October 14, 2026</td></tr>
      <tr><td>Rights to submit, one submission per project</td><td>Owner must confirm before submitting</td></tr>
      <tr><td>Restricted-jurisdiction screening and payout verification</td><td>Program review and builder verification required</td></tr>
      <tr><td>Arc USDC payout wallet</td><td>Owner must select a mainnet receiving wallet</td></tr>
    </tbody></table></section>
    <section><h2>Submission timing</h2><p>The pasted terms state October 14, 2026 at 23:59 Eastern Time — October 15, 2026 at 09:29 India Standard Time. Program dates may change; check the program page before submitting.</p><a href="https://dorahacks.io/hackathon/arc-microgrants/build" target="_blank" rel="noreferrer">Official Arc Microgrants page</a></section>
    <section><h2>What is implemented</h2><p>Owner funding and withdrawals, bounded agent payments, allowlists, expiry, revocation, replay protection, event history and a dedicated agent signer. These must be deployed and demonstrated on mainnet before the working-build requirement is met.</p><Link href="/arc" className="btn">Open Arc vault console</Link></section>
    <section><h2>Real testnet proof</h2><p>A real 0.01 USDC payment settled on Arc Testnet (5042002), followed by revocation. This is development evidence, not mainnet eligibility.</p><p><a href={`https://explorer.testnet.arc.io/tx/${demo.paymentHash}`} target="_blank" rel="noreferrer">Inspect the successful testnet payment</a></p><Link href="/testnet" className="btn">Open deployed testnet demo</Link></section>
  </div>;
}
