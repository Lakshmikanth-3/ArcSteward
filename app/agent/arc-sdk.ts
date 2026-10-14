import { createPublicClient, createWalletClient, http, erc20Abi, type Account, type Address, type Hex } from 'viem';
import { network, USDC, address, usdcAmount } from '../src/lib/arc/config';
import { vaultAbi } from '../src/lib/arc/abi';

export class ArcExecutionError extends Error {
  constructor(readonly hash: Hex, readonly status: 'reverted' | 'unknown', message: string) { super(message); }
}

/** Dedicated Arc SDK. Pass a secure signer; never import server credentials into a client component. */
export class ArcAgent {
  readonly chain;
  readonly publicClient;
  readonly walletClient;
  readonly vault: Address;
  constructor(readonly account: Account, vault: string, net: 'mainnet' | 'testnet', rpc?: string) {
    this.chain = network(net);
    this.vault = address(vault);
    this.publicClient = createPublicClient({ chain: this.chain, transport: http(rpc ?? this.chain.rpcUrls.default.http[0], { retryCount: 0, timeout: 15000 }) });
    this.walletClient = createWalletClient({ account, chain: this.chain, transport: http(rpc ?? this.chain.rpcUrls.default.http[0], { retryCount: 0 }) });
  }
  async state() {
    if (await this.publicClient.getChainId() !== this.chain.id) throw new Error('RPC chain mismatch');
    if (!await this.publicClient.getBytecode({ address: this.vault })) throw new Error('Vault has no bytecode');
    const token = await this.publicClient.readContract({ address: this.vault, abi: vaultAbi, functionName: 'usdc' });
    if (token.toLowerCase() !== USDC.toLowerCase()) throw new Error('Unsupported vault token');
    if (await this.publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'decimals' }) !== 6) throw new Error('USDC decimals mismatch');
    const [capability, balance] = await Promise.all([
      this.publicClient.readContract({ address: this.vault, abi: vaultAbi, functionName: 'capabilities', args: [this.account.address] }),
      this.publicClient.readContract({ address: this.vault, abi: vaultAbi, functionName: 'balance' }),
    ]);
    return { maxTotal: capability[0], maxPayment: capability[1], spent: capability[2], expiresAt: capability[3], version: capability[4], active: capability[5], balance, remainingBudget: capability[0] - capability[2] };
  }
  async pay(recipient: string, amount: string, paymentId: Hex) {
    const before = await this.state();
    const args = [address(recipient), usdcAmount(amount), paymentId] as const;
    if (!/^0x[0-9a-fA-F]{64}$/.test(paymentId) || /^0x0{64}$/.test(paymentId)) throw new Error('Nonzero bytes32 payment ID required');
    // Pre-flight eth_call with the real signer against the deployed contract; the contract stays authoritative.
    const { request } = await this.publicClient.simulateContract({ account: this.account, address: this.vault, abi: vaultAbi, functionName: 'pay', args });
    const hash = await this.walletClient.writeContract(request);
    // Do not retry automatically on timeout: query this hash and usedPaymentIds first.
    let receipt;
    try { receipt = await this.publicClient.waitForTransactionReceipt({ hash, timeout: 90000 }); }
    catch { throw new ArcExecutionError(hash, 'unknown', 'Payment submitted; receipt unavailable. Reconcile hash before retrying.'); }
    if (receipt.status !== 'success') throw new ArcExecutionError(hash, 'reverted', 'Payment reverted');
    let after;
    try { after = await this.state(); }
    catch { throw new ArcExecutionError(hash, 'unknown', 'Payment confirmed; state refresh unavailable. Reconcile hash and budget.'); }
    return { ok: true, hash, blockNumber: String(receipt.blockNumber), amountUnits: String(args[1]), recipient: args[0], paymentId, remainingBudget: String(after.remainingBudget), balance: String(after.balance), spentBefore: String(before.spent) };
  }
}
