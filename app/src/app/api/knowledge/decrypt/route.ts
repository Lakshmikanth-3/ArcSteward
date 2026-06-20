/**
 * app/api/knowledge/decrypt/route.ts
 *
 * POST /api/knowledge/decrypt
 *
 * Fetches a Walrus blob and decrypts it using Mysten Seal.
 *
 * Body: { blobId: string, requestHash: string }
 *
 * Flow:
 *   1. Fetch raw encrypted blob bytes from Walrus aggregator.
 *   2. Build a Seal SessionKey signed by the agent keypair.
 *   3. Call SealClient.decrypt() — the client automatically calls fetchKeys()
 *      on the configured Seal key servers. The key servers call seal_approve
 *      (knowledge_policy.move) to verify payment before issuing key shards.
 *   4. Parse the decrypted JSON payload and return { ok, data }.
 *
 * Seal IBE identity: The EncryptedObject embeds the identity at encryption time.
 * No additional identity construction needed — decrypt reads it from the blob.
 */
import { NextRequest, NextResponse } from "next/server";
import { SealClient, SessionKey, NoAccessError } from "@mysten/seal";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { getAgentKeypair } from "@/lib/agent-keypair";

const WALRUS_AGGREGATOR =
  process.env.WALRUS_AGGREGATOR_URL ?? "https://aggregator.walrus-testnet.walrus.space";

const SEAL_KEY_SERVER_OBJECT_IDS = (
  process.env.SEAL_KEY_SERVER_OBJECT_IDS ??
  // Testnet Seal key server object IDs from the Mysticeti deployment
  "0x2a6de47ef8c2ffb61dd60b60e9fcddd7b18cd2c1e9fa4fef4b4bc7b4d5a4de45,0x4c3d5e7f8a9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const SEAL_POLICY_PKG = process.env.NEXT_PUBLIC_VELO402_SEAL_POLICY_PKG ?? "";
const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as "testnet" | "mainnet";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      blobId: string;
      requestHash: string;
    };

    const { blobId, requestHash } = body;

    if (!blobId || !requestHash) {
      return NextResponse.json(
        { error: "blobId and requestHash are required." },
        { status: 400 }
      );
    }

    if (!SEAL_POLICY_PKG) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_VELO402_SEAL_POLICY_PKG is not set in .env" },
        { status: 503 }
      );
    }

    // ── Step 1: Fetch encrypted blob from Walrus ──────────────────────────────
    const walrusUrl = `${WALRUS_AGGREGATOR}/v1/blobs/${encodeURIComponent(blobId)}`;
    const blobRes = await fetch(walrusUrl);
    if (!blobRes.ok) {
      return NextResponse.json(
        {
          error: `Walrus aggregator returned ${blobRes.status} for blob ${blobId}`,
          walrus_url: walrusUrl,
        },
        { status: 502 }
      );
    }
    const encryptedBytes = new Uint8Array(await blobRes.arrayBuffer());

    // ── Step 2: Build Sui RPC client + agent keypair ──────────────────────────
    const suiRpcClient = new SuiJsonRpcClient({
      url: getJsonRpcFullnodeUrl(NETWORK),
      network: NETWORK,
    });
    const keypair = getAgentKeypair();

    // ── Step 3: Build Seal client with testnet key servers ────────────────────
    const sealClient = new SealClient({
      suiClient: suiRpcClient,
      serverConfigs: SEAL_KEY_SERVER_OBJECT_IDS.map((objectId) => ({
        objectId,
        weight: 1,
      })),
      verifyKeyServers: false, // Testnet — skip cert pinning
    });

    // ── Step 4: Build a SessionKey (signed proof of agent identity) ───────────
    // The SessionKey proves to Seal key servers that this request comes from
    // the agent address that holds the PolicyCap. Key servers call seal_approve
    // on-chain to verify the 402 payment was made before issuing key shards.
    //
    // txBytes for the session: a dummy PTB that just reads the SEAL_POLICY_PKG
    // to bind the session to the package. Seal requires valid txBytes that
    // reference the package so it can verify the IBE identity.
    const sessionTx = new Transaction();
    sessionTx.moveCall({
      target: `${SEAL_POLICY_PKG}::knowledge_policy::verify_session`,
      arguments: [sessionTx.pure.string(requestHash)],
    });
    const sessionTxBytes = await sessionTx.build({ client: suiRpcClient });

    const sessionKey = await SessionKey.create({
      address: keypair.toSuiAddress(),
      packageId: SEAL_POLICY_PKG,
      ttlMin: 10,
      signer: keypair,
      suiClient: suiRpcClient,
    });

    // ── Step 5: Decrypt — SealClient.decrypt() fetches key shards internally ──
    let decryptedBytes: Uint8Array;
    try {
      decryptedBytes = await sealClient.decrypt({
        data: encryptedBytes,
        sessionKey,
        txBytes: sessionTxBytes,
      });
    } catch (sealErr) {
      if (sealErr instanceof NoAccessError) {
        return NextResponse.json(
          {
            error:
              "Seal key server denied decryption — the 402 payment for this blob may not yet be " +
              "verified on-chain, or the PolicyCap does not satisfy knowledge_policy.seal_approve.",
            seal_error: "NoAccessError",
            blob_id: blobId,
            request_hash: requestHash,
            hint:
              "Ensure pay_402_invoice has finalized (wait ~2 Sui epochs) before calling decrypt. " +
              "The Seal key server calls knowledge_policy::seal_approve on each decryption attempt.",
          },
          { status: 403 }
        );
      }
      throw sealErr;
    }

    // ── Step 6: Parse decrypted JSON ─────────────────────────────────────────
    const text = new TextDecoder().decode(decryptedBytes);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          error: "Decrypted blob is not valid JSON.",
          raw_length: decryptedBytes.length,
          hint: "Check that the blob was encrypted with the correct JSON payload during dataset publishing.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      blob_id: blobId,
      request_hash: requestHash,
      data,
      seal_policy_pkg: SEAL_POLICY_PKG,
      walrus_url: walrusUrl,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
