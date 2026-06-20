/**
 * lib/ptb-builders.ts
 * Functions that assemble Programmable Transaction Blocks (PTBs) for every
 * action the agent or the human operator can perform.
 *
 * None of these functions sign or submit — they only build the Transaction
 * object so callers can attach the appropriate keypair.
 */
import { Transaction } from "@mysten/sui/transactions";
import { PACKAGE_ID, TREASURY_ID, POLICY_CAP_ID } from "./sui-client";

// ─── Human operator PTBs ─────────────────────────────────────────────────────

/**
 * Builds a PTB that mints a PolicyCap for the agent.
 * Must be signed by the human's wallet (OwnerCap holder).
 */
export function buildMintPolicyTx({
  ownerCapId,
  maxSpendMist,
  expirationEpoch,
  allowedScopes,
  attestedComputeRequired,
  expectedPcr0,
  agentAddress,
}: {
  ownerCapId: string;
  maxSpendMist: bigint;
  expirationEpoch: number;
  allowedScopes: number[];
  attestedComputeRequired: boolean;
  expectedPcr0: string; // hex string from EXPECTED_PCR0 env var
  agentAddress: string;
}): Transaction {
  const tx = new Transaction();

  const pcr0Bytes = Array.from(Buffer.from(expectedPcr0, "hex"));

  tx.moveCall({
    target: `${PACKAGE_ID}::velo_wallet::mint_policy`,
    arguments: [
      tx.object(ownerCapId),
      tx.object(TREASURY_ID),
      tx.pure.u64(maxSpendMist),
      tx.pure.u64(expirationEpoch),
      tx.pure(bcs_encode_u8_vec(allowedScopes)),
      tx.pure.bool(attestedComputeRequired),
      tx.pure(bcs_encode_u8_vec(pcr0Bytes)),
      tx.pure.address(agentAddress),
    ],
  });

  return tx;
}

/**
 * Builds a PTB to deposit SUI into the treasury.
 * `coinObjectId` — the SUI Coin object being deposited.
 */
export function buildDepositTx(coinObjectId: string): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::velo_wallet::deposit`,
    arguments: [tx.object(TREASURY_ID), tx.object(coinObjectId)],
  });

  return tx;
}

/**
 * Builds the kill-switch PTB.  Permanently deletes the agent's PolicyCap.
 * Must be signed by the human's wallet (OwnerCap holder).
 */
export function buildRevokePolicyTx({
  ownerCapId,
  policyCapId,
}: {
  ownerCapId: string;
  policyCapId: string;
}): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::velo_wallet::revoke_policy`,
    arguments: [tx.object(ownerCapId), tx.object(policyCapId)],
  });

  return tx;
}

// ─── Agent PTBs ──────────────────────────────────────────────────────────────

/**
 * Builds the pay_402_invoice PTB.
 * Signed by the agent's throwaway keypair.
 */
export function buildPay402Tx({
  amountMist,
  recipient,
  nonce,
  nautilusAttestationHash,
}: {
  amountMist: bigint;
  recipient: string;
  nonce: string;
  nautilusAttestationHash: Uint8Array;
}): Transaction {
  const tx = new Transaction();

  // The process.env reference here ensures it uses the registry from .env
  const PAYMENT_REGISTRY_ID = process.env.NEXT_PUBLIC_PAYMENT_REGISTRY_ID;
  if (!PAYMENT_REGISTRY_ID) {
    throw new Error("NEXT_PUBLIC_PAYMENT_REGISTRY_ID is not set in .env — run scripts/create-payment-registry.ts first");
  }

  tx.moveCall({
    target: `${PACKAGE_ID}::velo_wallet::pay_402_invoice`,
    arguments: [
      tx.object(POLICY_CAP_ID),
      tx.object(TREASURY_ID),
      tx.object(PAYMENT_REGISTRY_ID),
      tx.pure.string(nonce),
      tx.pure.u64(amountMist),
      tx.pure(bcs_encode_u8_vec(Array.from(nautilusAttestationHash))),
      tx.pure.address(recipient),
      tx.object("0x6"), // Sui Clock
    ],
  });

  return tx;
}

/**
 * Builds a DeepBook Spot order funding PTB.
 */
export function buildDeepbookSpotTx({
  amountMist,
  deepbookBalanceManager,
}: {
  amountMist: bigint;
  deepbookBalanceManager: string;
}): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::velo_wallet::pay_deepbook_spot`,
    arguments: [
      tx.object(POLICY_CAP_ID),
      tx.object(TREASURY_ID),
      tx.pure.u64(amountMist),
      tx.pure.address(deepbookBalanceManager),
    ],
  });

  return tx;
}

/**
 * Builds a DeepBook Margin or Predict PTB.
 * scope_tag: 3 = DEEPBOOK_MARGIN, 4 = DEEPBOOK_PREDICT
 */
export function buildDeepbookAdvancedTx({
  amountMist,
  scopeTag,
  deepbookMarginPoolId,
  deepbookPredictPoolId,
}: {
  amountMist: bigint;
  scopeTag: 3 | 4;
  deepbookMarginPoolId: string;
  deepbookPredictPoolId: string;
}): Transaction {
  const tx = new Transaction();

  // Route to the correct DeepBook Pool
  const poolId = scopeTag === 3 ? deepbookMarginPoolId : deepbookPredictPoolId;

  tx.moveCall({
    target: `${PACKAGE_ID}::velo_wallet::pay_deepbook_advanced`,
    arguments: [
      tx.object(POLICY_CAP_ID),
      tx.object(TREASURY_ID),
      tx.pure.u64(amountMist),
      tx.pure.u8(scopeTag),
      tx.object(poolId), // Real pool ID implementation
    ],
  });

  return tx;
}

// ─── BCS helpers ─────────────────────────────────────────────────────────────

/** Encodes a number[] as a Move vector<u8> in BCS format. */
function bcs_encode_u8_vec(values: number[]): Uint8Array {
  // BCS vector<u8>: ULEB128 length prefix + raw bytes
  const len = values.length;
  const uleb = encodeUleb128(len);
  const buf = new Uint8Array(uleb.length + len);
  buf.set(uleb, 0);
  buf.set(new Uint8Array(values), uleb.length);
  return buf;
}

function encodeUleb128(value: number): Uint8Array {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return new Uint8Array(bytes);
}
