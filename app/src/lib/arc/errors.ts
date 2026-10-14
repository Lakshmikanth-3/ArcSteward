import { BaseError, ContractFunctionRevertedError, decodeErrorResult } from 'viem';
import { vaultAbi } from './abi';

const reasons: Record<string, string> = {
  Unauthorized: 'Unauthorized: this agent is revoked or has no active capability.',
  NotOwner: 'Only the vault owner can perform this operation.',
  Expired: 'The capability has expired.',
  RecipientDenied: 'This recipient is not permitted by the capability.',
  PaymentLimit: 'The amount exceeds the per-payment limit.',
  TotalLimit: 'The amount exceeds the remaining lifetime budget.',
  DailyLimit: 'The amount exceeds the remaining daily limit. It resets at 00:00 UTC.',
  GasLimit: 'The amount exceeds the remaining gas allowance.',
  InsufficientFunds: 'The vault has insufficient USDC.',
  DuplicatePayment: 'This payment ID has already been used. Inspect the earlier receipt.',
  InvalidInput: 'Invalid input. Check amounts, addresses, expiry and recipient list.',
  UnsupportedToken: 'The token does not match the required USDC interface.',
};

export function paymentError(error: unknown): string {
  if (error instanceof BaseError) {
    const revert = error.walk(e => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) return reasons[revert.data.errorName] ?? 'Contract rejected the operation.';
    // Some RPCs (including Ganache) use -32000 with raw revert bytes.
    let current: unknown = error;
    for (let i = 0; i < 12 && current && typeof current === 'object'; i++) {
      const item = current as { data?: unknown; cause?: unknown; name?: string };
      if (item.name === 'UserRejectedRequestError') return 'Request rejected in your wallet.';
      if (typeof item.data === 'string' && /^0x[0-9a-fA-F]+$/.test(item.data)) {
        try { const decoded = decodeErrorResult({ abi: vaultAbi, data: item.data as `0x${string}` }); return reasons[decoded.errorName] ?? 'Contract rejected the operation.'; } catch { /* Not contract revert data. */ }
      }
      current = item.cause;
    }
    return 'Transaction or RPC request failed. Check network, available USDC, gas and capability. Inspect any submitted hash before retrying.';
  }
  return error instanceof Error ? error.message.slice(0, 300) : 'Operation failed';
}
