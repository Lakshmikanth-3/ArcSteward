import { Suspense } from 'react';
import type { Metadata } from 'next';
import AuditApp from './AuditApp';
import '../../codex.css';
import '../earlypay.css';

export const metadata: Metadata = { title: 'Audit · ArcSteward EarlyPay', description: 'Replay every EarlyPay decision and verify the on-chain hash chain in your browser.' };

export default function AuditPage() { return <Suspense><AuditApp /></Suspense>; }
