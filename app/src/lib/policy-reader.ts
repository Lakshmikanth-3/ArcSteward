/**
 * lib/policy-reader.ts
 * Reads the live PolicyCap and Treasury objects from Sui gRPC.
 * Used by the dashboard to render the mission-control gauges.
 */
import { bcs } from "@mysten/sui/bcs";
import { suiClient, TREASURY_ID, POLICY_CAP_ID, PACKAGE_ID } from "./sui-client";

// Mirrors move/velo402/sources/velo_wallet.move's PolicyCap/Treasury struct
// layout field-for-field. Confirmed empirically (2026-08-25, against Sui's
// well-known SuiSystemState object at 0x5) that gRPC's `content: true` bytes
// include the leading `id: UID` field as a raw 32-byte address, matching the
// Move struct definition exactly -- not stripped.
const PolicyCapBcs = bcs.struct("PolicyCap", {
  id: bcs.Address,
  treasury_id: bcs.Address,
  max_spend: bcs.U64,
  current_spend: bcs.U64,
  expiration_epoch: bcs.U64,
  allowed_scopes: bcs.vector(bcs.U8),
  attested_compute_required: bcs.Bool,
  expected_pcr0: bcs.vector(bcs.U8),
});

// Balance<SUI> is `struct Balance<phantom T> has store { value: u64 }` --
// the phantom type parameter adds no bytes, so it's just a u64 in BCS.
const TreasuryBcs = bcs.struct("Treasury", {
  id: bcs.Address,
  balance: bcs.U64,
  label: bcs.vector(bcs.U8),
});

export interface PolicyCapState {
  id: string;
  treasuryId: string;
  maxSpend: bigint;
  currentSpend: bigint;
  remainingBudget: bigint;
  expirationEpoch: number;
  allowedScopes: number[];
  attestedComputeRequired: boolean;
  exists: boolean;
}

export interface TreasuryState {
  id: string;
  balanceMist: bigint;
  label: string;
}

function parsePolicyCap(objectId: string, content: Uint8Array): PolicyCapState {
  const fields = PolicyCapBcs.parse(content);
  const maxSpend = BigInt(fields.max_spend);
  const currentSpend = BigInt(fields.current_spend);
  return {
    id: objectId,
    treasuryId: fields.treasury_id,
    maxSpend,
    currentSpend,
    remainingBudget: maxSpend > currentSpend ? maxSpend - currentSpend : BigInt(0),
    expirationEpoch: Number(fields.expiration_epoch),
    allowedScopes: fields.allowed_scopes,
    attestedComputeRequired: fields.attested_compute_required,
    exists: true,
  };
}

export async function fetchPolicyCap(): Promise<PolicyCapState> {
  if (!POLICY_CAP_ID) {
    return buildEmptyPolicy("", false);
  }

  try {
    const res = await suiClient.getObject({
      objectId: POLICY_CAP_ID,
      include: { content: true },
    });
    if (!res.object.content) return buildEmptyPolicy(POLICY_CAP_ID, false);
    return parsePolicyCap(res.object.objectId, res.object.content);
  } catch {
    // Object not found/deleted (e.g. revoked) -- gRPC throws rather than
    // returning an error field the way JSON-RPC did.
    return buildEmptyPolicy(POLICY_CAP_ID, false);
  }
}

export async function fetchSwarmPolicyCaps(): Promise<PolicyCapState[]> {
  // Known placeholder addresses from the old mint-swarm.ts script — filter these out
  const PLACEHOLDER_AGENT_ADDRESSES = new Set([
    "0x1111111111111111111111111111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333333333333333333333333333",
  ]);

  try {
    // 1. Fetch PolicyMintedEvents to find all PolicyCaps
    const eventsRes = await suiClient.core.listEvents({
      filter: { eventType: `${PACKAGE_ID}::velo_wallet::PolicyMintedEvent` },
      limit: 50,
      order: "descending",
    });

    // 2. Extract unique PolicyCap IDs associated with our Treasury, excluding placeholder agents
    const policyCapIds = Array.from(new Set(
      eventsRes.events
        .filter((e) => {
          const parsed = e.json as any;
          const isOurTreasury = parsed?.treasury_id === TREASURY_ID;
          const isPlaceholder = PLACEHOLDER_AGENT_ADDRESSES.has(parsed?.agent_address);
          return isOurTreasury && !isPlaceholder;
        })
        .map((e) => (e.json as any)?.policy_cap_id as string)
    ));

    if (policyCapIds.length === 0) return [];

    // 3. Fetch all objects — each entry is either the object or an Error
    // (revoked/deleted PolicyCaps come back as Error, not thrown).
    const res = await suiClient.getObjects({
      objectIds: policyCapIds,
      include: { content: true },
    });

    // 4. Map to PolicyCapState
    const policies: PolicyCapState[] = [];
    for (const obj of res.objects) {
      if (obj instanceof Error || !obj.content) {
        continue; // Object deleted (revoked) or invalid
      }
      policies.push(parsePolicyCap(obj.objectId, obj.content));
    }

    return policies;
  } catch (err) {
    console.error("fetchSwarmPolicyCaps error:", err);
    return [];
  }
}

export async function fetchTreasury(): Promise<TreasuryState> {
  if (!TREASURY_ID) {
    return { id: "", balanceMist: BigInt(0), label: "Unset" };
  }

  try {
    const res = await suiClient.getObject({
      objectId: TREASURY_ID,
      include: { content: true },
    });
    if (!res.object.content) {
      return { id: TREASURY_ID, balanceMist: BigInt(0), label: "Unknown" };
    }

    const fields = TreasuryBcs.parse(res.object.content);
    return {
      id: TREASURY_ID,
      balanceMist: BigInt(fields.balance),
      label: fields.label.length ? Buffer.from(fields.label).toString("utf8") : "Agent Treasury",
    };
  } catch {
    return { id: TREASURY_ID, balanceMist: BigInt(0), label: "Unknown" };
  }
}

function buildEmptyPolicy(id: string, exists: boolean): PolicyCapState {
  return {
    id,
    treasuryId: "",
    maxSpend: BigInt(0),
    currentSpend: BigInt(0),
    remainingBudget: BigInt(0),
    expirationEpoch: 0,
    allowedScopes: [],
    attestedComputeRequired: false,
    exists,
  };
}
