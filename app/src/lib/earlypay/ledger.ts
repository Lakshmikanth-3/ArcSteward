// EarlyPayLedger addresses and EIP-712 definitions shared by the agent, API and pages.
import testnet from './testnet-ledger.json';
import type { Hex } from './types';

export const LEDGER: Record<'testnet' | 'mainnet', Hex | undefined> = {
  testnet: testnet.ledger as Hex,
  mainnet: undefined, // not deployed on mainnet; requires explicit owner confirmation
};
export const LEDGER_FROM_BLOCK: Record<'testnet' | 'mainnet', bigint> = { testnet: BigInt(testnet.block), mainnet: 0n };
export const PAYOUT_COOLDOWN_SECONDS = testnet.cooldownSeconds;

export const domain = (chainId: number, verifyingContract: Hex) => ({ name: 'ArcSteward EarlyPay', version: '1', chainId, verifyingContract });

export const offerTypes = {
  Offer: [
    { name: 'vault', type: 'address' }, { name: 'supplier', type: 'address' }, { name: 'invoiceHash', type: 'bytes32' },
    { name: 'faceAmount', type: 'uint256' }, { name: 'discountBps', type: 'uint16' }, { name: 'payout', type: 'address' },
    { name: 'dueDate', type: 'uint64' }, { name: 'expiry', type: 'uint64' },
  ],
} as const;

export const registrationTypes = {
  Registration: [{ name: 'supplier', type: 'address' }, { name: 'payout', type: 'address' }, { name: 'profileHash', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }],
} as const;
