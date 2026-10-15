import ArcConsole from '@/components/ArcConsole';
import mainnet from '@/lib/arc/mainnet-deployment.json';

export default function ArcPage() {
  const networkName = process.env.NEXT_PUBLIC_ARC_NETWORK ?? 'mainnet';
  if (networkName !== 'mainnet' && networkName !== 'testnet') throw new Error('Invalid Arc network configuration');
  const live = networkName === 'mainnet';
  return <ArcConsole networkName={networkName} rpcUrl={process.env.NEXT_PUBLIC_ARC_RPC_URL} factoryAddress={process.env.NEXT_PUBLIC_ARC_FACTORY_ADDRESS ?? (live ? mainnet.factory : '')} initialVault={live ? mainnet.vault : ''} initialAgent={live ? mainnet.agent : ''} />;
}
