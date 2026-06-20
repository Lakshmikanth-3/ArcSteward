/**
 * lib/policy-reader.ts
 * Reads the live PolicyCap and Treasury objects from Sui RPC.
 * Used by the dashboard to render the mission-control gauges.
 */
import { suiClient, TREASURY_ID, POLICY_CAP_ID, PACKAGE_ID } from "./sui-client";

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

export async function fetchPolicyCap(): Promise<PolicyCapState> {
  if (!POLICY_CAP_ID) {
    return {
      id: "",
      treasuryId: "",
      maxSpend: BigInt(0),
      currentSpend: BigInt(0),
      remainingBudget: BigInt(0),
      expirationEpoch: 0,
      allowedScopes: [],
      attestedComputeRequired: false,
      exists: false,
    };
  }

  try {
    const obj = await suiClient.getObject({
      id: POLICY_CAP_ID,
      options: { showContent: true },
    });

    if (
      obj.error ||
      !obj.data?.content ||
      obj.data.content.dataType !== "moveObject"
    ) {
      return buildEmptyPolicy(POLICY_CAP_ID, false);
    }

    const fields = (obj.data.content as any).fields as Record<string, any>;
    const maxSpend = BigInt(fields.max_spend ?? 0);
    const currentSpend = BigInt(fields.current_spend ?? 0);

    return {
      id: POLICY_CAP_ID,
      treasuryId: fields.treasury_id,
      maxSpend,
      currentSpend,
      remainingBudget:
        maxSpend > currentSpend ? maxSpend - currentSpend : BigInt(0),
      expirationEpoch: Number(fields.expiration_epoch ?? 0),
      allowedScopes: Array.from(fields.allowed_scopes ?? []) as number[],
      attestedComputeRequired: Boolean(fields.attested_compute_required),
      exists: true,
    };
  } catch {
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
    const eventsRes = await suiClient.queryEvents({
      query: { MoveEventType: `${PACKAGE_ID}::velo_wallet::PolicyMintedEvent` },
      limit: 50,
      order: "descending",
    });

    // 2. Extract unique PolicyCap IDs associated with our Treasury, excluding placeholder agents
    const policyCapIds = Array.from(new Set(
      eventsRes.data
        .filter((e) => {
          const parsed = e.parsedJson as any;
          const isOurTreasury = parsed?.treasury_id === TREASURY_ID;
          const isPlaceholder = PLACEHOLDER_AGENT_ADDRESSES.has(parsed?.agent_address);
          return isOurTreasury && !isPlaceholder;
        })
        .map((e) => (e.parsedJson as any)?.policy_cap_id as string)
    ));

    if (policyCapIds.length === 0) return [];

    // 3. Fetch all objects
    const objs = await suiClient.multiGetObjects({
      ids: policyCapIds,
      options: { showContent: true },
    });

    // 4. Map to PolicyCapState
    const policies: PolicyCapState[] = [];
    for (const obj of objs) {
      if (obj.error || !obj.data?.content || obj.data.content.dataType !== "moveObject") {
        continue; // Object deleted (revoked) or invalid
      }
      const fields = (obj.data.content as any).fields as Record<string, any>;
      const maxSpend = BigInt(fields.max_spend ?? 0);
      const currentSpend = BigInt(fields.current_spend ?? 0);

      policies.push({
        id: obj.data.objectId,
        treasuryId: fields.treasury_id,
        maxSpend,
        currentSpend,
        remainingBudget: maxSpend > currentSpend ? maxSpend - currentSpend : BigInt(0),
        expirationEpoch: Number(fields.expiration_epoch ?? 0),
        allowedScopes: Array.from(fields.allowed_scopes ?? []) as number[],
        attestedComputeRequired: Boolean(fields.attested_compute_required),
        exists: true,
      });
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

  const obj = await suiClient.getObject({
    id: TREASURY_ID,
    options: { showContent: true },
  });

  if (
    obj.error ||
    !obj.data?.content ||
    obj.data.content.dataType !== "moveObject"
  ) {
    return { id: TREASURY_ID, balanceMist: BigInt(0), label: "Unknown" };
  }

  const fields = (obj.data.content as any).fields as Record<string, any>;
  const rawBalance = fields.balance?.fields?.value ?? fields.balance ?? "0";

  return {
    id: TREASURY_ID,
    balanceMist: BigInt(rawBalance),
    label: fields.label
      ? Buffer.from(fields.label).toString("utf8")
      : "Agent Treasury",
  };
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
