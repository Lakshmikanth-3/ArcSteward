import ArcConsole from '@/components/ArcConsole';
import demo from '@/lib/arc/testnet-demo.json';

export default function TestnetPage() {
  return <ArcConsole networkName="testnet" rpcUrl={process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL} factoryAddress={process.env.NEXT_PUBLIC_ARC_TESTNET_FACTORY_ADDRESS ?? demo.factory} initialVault={demo.vault} initialAgent={demo.agent} />;
}
