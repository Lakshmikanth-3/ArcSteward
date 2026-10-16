import type { Metadata } from 'next';
import BuyerApp from './BuyerApp';
import '../../codex.css';
import '../earlypay.css';

export const metadata: Metadata = { title: 'Buyer · ArcSteward EarlyPay', description: 'Approve suppliers, review the treasury agent\'s decisions and resolve escalations.' };

export default function BuyerPage() { return <BuyerApp />; }
