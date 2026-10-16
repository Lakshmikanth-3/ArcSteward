import { Suspense } from 'react';
import type { Metadata } from 'next';
import SupplierApp from './SupplierApp';
import '../../codex.css';
import '../earlypay.css';

export const metadata: Metadata = { title: 'Supplier · ArcSteward EarlyPay', description: 'Register, send an invoice and get paid early in USDC on Arc.' };

export default function SupplierPage() {
  return <Suspense><SupplierApp /></Suspense>;
}
