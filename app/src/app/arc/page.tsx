import ArcConsole from '@/components/ArcConsole';

export default function ArcPage() {
  const networkName = process.env.NEXT_PUBLIC_ARC_NETWORK ?? 'mainnet';
  if (networkName !== 'mainnet' && networkName !== 'testnet') throw new Error('Invalid Arc network configuration');
  return <ArcConsole networkName={networkName} rpcUrl={process.env.NEXT_PUBLIC_ARC_RPC_URL} factoryAddress={process.env.NEXT_PUBLIC_ARC_FACTORY_ADDRESS} />;
}
