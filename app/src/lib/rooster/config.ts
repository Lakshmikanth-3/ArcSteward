/**
 * lib/rooster/config.ts
 * Central config for the Rooster integration + Base settlement network.
 * SERVER-SIDE ONLY.
 *
 * Lazy getters — throw only when a value is actually read, mirroring
 * lib/agent-keypair.ts's getAgentKeypair() pattern, so importing this module
 * never breaks a build/dev-server that hasn't configured Rooster yet.
 */

export type SettlementNetwork = "development" | "base-sepolia" | "base";

export interface RoosterConfig {
  baseUrl: string;
  apiKey: string;
  testMode: boolean;
}

export function getRoosterConfig(): RoosterConfig {
  const apiKey = process.env.ROOSTER_AGENT_KEY;
  if (!apiKey) {
    throw new Error(
      "ROOSTER_AGENT_KEY env var is not set. Add it to app/.env (see .env.example). " +
        "Never hardcode this key in source, and never log it.",
    );
  }
  const baseUrl = (
    process.env.ROOSTER_BASE_URL ?? "https://roosteragents.ai/agent-economy"
  ).replace(/\/$/, "");
  const testMode =
    (process.env.ROOSTER_TEST_MODE ?? "true").toLowerCase() !== "false";
  return { baseUrl, apiKey, testMode };
}

export function getSettlementNetwork(): SettlementNetwork {
  const net = (process.env.SETTLEMENT_NETWORK ?? "development").toLowerCase();
  if (net === "development" || net === "base-sepolia" || net === "base") {
    return net;
  }
  throw new Error(
    `Unknown SETTLEMENT_NETWORK "${net}". Expected development | base-sepolia | base.`,
  );
}

/**
 * Mainnet funding requires BOTH SETTLEMENT_NETWORK=base AND this explicit
 * opt-in flag. Absence of either keeps the funding path inert — no code
 * path can move real funds by accident.
 */
export function isMainnetAllowed(): boolean {
  return (process.env.ROOSTER_ALLOW_MAINNET ?? "false").toLowerCase() === "true";
}

/**
 * Shared secret required on every call to the operator-only
 * POST /api/rooster/capabilities route. Fails closed: unset means the route
 * refuses all requests rather than defaulting to open.
 */
export function getRoosterOperatorKey(): string {
  const key = process.env.ROOSTER_OPERATOR_KEY;
  if (!key) {
    throw new Error(
      "ROOSTER_OPERATOR_KEY env var is not set. Required to issue capabilities " +
        "via POST /api/rooster/capabilities. Add it to app/.env (see .env.example).",
    );
  }
  return key;
}

/**
 * Hard ceiling (defense in depth beyond the settlement wallet's actual
 * balance) on the maxAmountCents any single capability can grant. Fails
 * closed: unset means the route refuses all requests.
 */
export function getMaxCapabilityCents(): number {
  const raw = process.env.ROOSTER_MAX_CAPABILITY_CENTS;
  if (!raw) {
    throw new Error(
      "ROOSTER_MAX_CAPABILITY_CENTS env var is not set. Required to issue capabilities " +
        "via POST /api/rooster/capabilities. Add it to app/.env (see .env.example).",
    );
  }
  const cents = Number(raw);
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error(`ROOSTER_MAX_CAPABILITY_CENTS must be a positive integer, got "${raw}".`);
  }
  return cents;
}

export interface BaseChainConfig {
  rpcUrl: string;
  usdcContract: `0x${string}`;
  chainId: number;
  privateKey: `0x${string}`;
}

// Circle-issued official USDC test token on Base Sepolia (verified against
// developers.circle.com/stablecoins/usdc-contract-addresses).
const DEFAULT_USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
// Circle-issued official USDC on Base mainnet.
const DEFAULT_USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function getEvmPrivateKey(): `0x${string}` {
  const raw = process.env.EVM_SETTLEMENT_PRIVATE_KEY;
  if (!raw) {
    throw new Error(
      "EVM_SETTLEMENT_PRIVATE_KEY env var is not set. This must be a DEDICATED " +
        "EVM key for Base settlement — never reuse the Sui AGENT_PRIVATE_KEY. " +
        "Add it to app/.env (see .env.example).",
    );
  }
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

/** Resolves RPC URL / USDC contract / chain id for the active SettlementNetwork. */
export function getBaseChainConfig(network: SettlementNetwork): BaseChainConfig {
  if (network === "development") {
    throw new Error(
      'SETTLEMENT_NETWORK is "development" — no chain is configured. ' +
        'Set SETTLEMENT_NETWORK=base-sepolia in app/.env to enable real settlement.',
    );
  }

  if (network === "base-sepolia") {
    return {
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      usdcContract: (process.env.USDC_BASE_SEPOLIA_CONTRACT ??
        DEFAULT_USDC_BASE_SEPOLIA) as `0x${string}`,
      chainId: 84532,
      privateKey: getEvmPrivateKey(),
    };
  }

  // network === "base" (mainnet) — caller must have already checked isMainnetAllowed().
  return {
    rpcUrl: process.env.BASE_MAINNET_RPC_URL ?? "https://mainnet.base.org",
    usdcContract: (process.env.USDC_BASE_MAINNET_CONTRACT ??
      DEFAULT_USDC_BASE_MAINNET) as `0x${string}`,
    chainId: 8453,
    privateKey: getEvmPrivateKey(),
  };
}
