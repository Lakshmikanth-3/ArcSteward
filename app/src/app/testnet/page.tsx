import ArcConsole from '@/components/ArcConsole';
import deployment from '@/lib/arc/testnet-deployment.json';

export default function TestnetPage() {
  return <ArcConsole networkName="testnet" rpcUrl={process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL} factoryAddress={process.env.NEXT_PUBLIC_ARC_TESTNET_FACTORY_ADDRESS ?? deployment.factory} initialVault={deployment.vault} initialAgent={deployment.agent} />;
}
