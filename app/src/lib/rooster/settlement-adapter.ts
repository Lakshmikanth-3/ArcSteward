/**
 * lib/rooster/settlement-adapter.ts
 * Real Base settlement — signs and submits actual USDC ERC-20 transfers.
 * SERVER-SIDE ONLY. Uses a DEDICATED EVM key (EVM_SETTLEMENT_PRIVATE_KEY),
 * never the Sui AGENT_PRIVATE_KEY.
 *
 * bridgeFromSui() is intentionally NOT implemented — there is no existing
 * mechanism (no CCTP integration, no custodial rebalancer) to move Treasury
 * SUI into this EVM wallet automatically, and this pilot doesn't require one
 * since RoosterCapability authorization is entirely off-chain. The wallet
 * must be manually funded with testnet USDC today, exactly as the Sui
 * Treasury is manually funded via scripts/deposit-treasury.ts. Calling
 * bridgeFromSui() always throws SettlementNotImplementedError — it never
 * pretends to succeed.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Chain,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import {
  getBaseChainConfig,
  getSettlementNetwork,
  isMainnetAllowed,
  type SettlementNetwork,
} from "./config";
import { roosterLogger } from "./logger";
import { SettlementNotImplementedError } from "./types";

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const USDC_DECIMALS = 6;

export interface FundParams {
  offerId: string;
  depositAddress: `0x${string}`;
  /** Actual escrow funding amount owed, in USD cents (price + marketplace fee). */
  amountCents: number;
  /**
   * The ERC-20 token contract to send to, read from Rooster's live funding
   * response. Base Sepolia and Base mainnet USDC are DIFFERENT contract
   * addresses (confirmed by Rooster 2026-08-26 — this exact gap reverted
   * another founding agent's transfer). Falls back to the configured
   * network default only if Rooster's response omits it.
   */
  tokenContract?: `0x${string}`;
  /** ERC-20 decimals for tokenContract — falls back to USDC_DECIMALS (6) if omitted. */
  tokenDecimals?: number;
}

export interface FundResult {
  txHash: Hash;
  network: SettlementNetwork;
}

export interface ConfirmationResult {
  status: "confirmed" | "failed";
  blockNumber: bigint;
  confirmations: number;
}

export interface SettlementAdapter {
  fund(params: FundParams): Promise<FundResult>;
  waitForConfirmation(txHash: Hash, opts?: { timeoutMs?: number }): Promise<ConfirmationResult>;
  bridgeFromSui(amountMist: bigint): Promise<never>;
}

function centsToTokenUnits(amountCents: number, decimals: number): bigint {
  // amountCents is USD cents.
  return parseUnits((amountCents / 100).toFixed(decimals), decimals);
}

export class BaseSepoliaSettlementAdapter implements SettlementAdapter {
  private readonly network: SettlementNetwork;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly usdcContract: `0x${string}`;

  constructor(network?: SettlementNetwork) {
    this.network = network ?? getSettlementNetwork();

    if (this.network === "development") {
      throw new Error(
        'SETTLEMENT_NETWORK is "development" — cannot construct a settlement adapter. ' +
          "Set SETTLEMENT_NETWORK=base-sepolia to run real settlement.",
      );
    }
    if (this.network === "base" && !isMainnetAllowed()) {
      throw new Error(
        "Refusing to construct a mainnet settlement adapter: SETTLEMENT_NETWORK=base requires " +
          "ROOSTER_ALLOW_MAINNET=true as an explicit, separate opt-in. Neither flag alone is enough.",
      );
    }

    const chainCfg = getBaseChainConfig(this.network);
    const chain: Chain = this.network === "base" ? base : baseSepolia;
    const account = privateKeyToAccount(chainCfg.privateKey);
    this.usdcContract = chainCfg.usdcContract;

    const transport = http(chainCfg.rpcUrl);
    this.publicClient = createPublicClient({ chain, transport }) as PublicClient;
    this.walletClient = createWalletClient({ account, chain, transport }) as WalletClient;
  }

  async fund(params: FundParams): Promise<FundResult> {
    // Prefer the token contract/decimals Rooster reports on the live funding
    // response over the configured constant — Base Sepolia and Base mainnet
    // USDC are different contract addresses, and this is per-offer, not
    // per-deployment, information.
    const tokenContract = params.tokenContract ?? this.usdcContract;
    const tokenDecimals = params.tokenDecimals ?? USDC_DECIMALS;
    const amount = centsToTokenUnits(params.amountCents, tokenDecimals);

    roosterLogger.info("Submitting Base settlement transfer", {
      offerId: params.offerId,
      network: this.network,
      amountCents: params.amountCents,
      tokenContract,
    });

    const txHash = await this.walletClient.writeContract({
      address: tokenContract,
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [params.depositAddress, amount],
      account: this.walletClient.account!,
      chain: this.walletClient.chain,
    });

    roosterLogger.info("Base settlement transfer submitted", {
      offerId: params.offerId,
      network: this.network,
      txHash,
    });

    return { txHash, network: this.network };
  }

  async waitForConfirmation(
    txHash: Hash,
    opts: { timeoutMs?: number } = {},
  ): Promise<ConfirmationResult> {
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: opts.timeoutMs ?? 120_000,
    });
    return {
      status: receipt.status === "success" ? "confirmed" : "failed",
      blockNumber: receipt.blockNumber,
      confirmations: 1,
    };
  }

  async bridgeFromSui(): Promise<never> {
    throw new SettlementNotImplementedError(
      "Sui -> Base bridging is not implemented. There is no existing mechanism in this " +
        "codebase (or natively between Sui and Base) to trustlessly move Velo402 Treasury " +
        "SUI into this EVM settlement wallet. Real options: (1) Circle's CCTP if/when it " +
        "supports Sui, (2) an interim manually-triggered operator rebalancing script " +
        "(analogous to scripts/deposit-treasury.ts), or (3) a dedicated bridge protocol " +
        "integration. This adapter intentionally refuses to fake either path.",
    );
  }
}

/** DI seam so callers (e.g. fund/route.ts) can inject a test double instead of a real adapter. */
export function createSettlementAdapter(network?: SettlementNetwork): SettlementAdapter {
  return new BaseSepoliaSettlementAdapter(network);
}
