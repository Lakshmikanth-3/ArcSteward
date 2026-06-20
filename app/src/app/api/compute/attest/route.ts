/**
 * app/api/compute/attest/route.ts
 *
 * POST /api/compute/attest
 *
 * Nautilus Attestation Proxy.
 *
 * In production (AWS EC2 with Nitro Enclave):
 *   1. The enclave runs the agent's reasoning code.
 *   2. AWS generates an attestation document containing PCR0 — the SHA-384
 *      hash of the enclave image (EIF). This hash is deterministic: the same
 *      source code always produces the same PCR0.
 *   3. This route forwards the request to the enclave's local vsock socket
 *      (or IMDS endpoint) and returns the PCR0 to the caller.
 *   4. The agent includes this PCR0 in its PTB via `expected_pcr0`.
 *   5. The Move contract's `assert!` on-chain verifies the submitted PCR0
 *      matches the value stored in the PolicyCap — if the agent's code was
 *      tampered with, the hash won't match, and the transaction aborts.
 *
 * On this Windows dev machine (no Nitro Enclave available):
 *   - The route returns the EXPECTED_PCR0 from `.env`, which IS the value
 *     the PolicyCap was minted with. The Move-level assert! gate is LIVE and
 *     enforced on-chain — this endpoint is the "last mile" HTTP proxy that
 *     would connect to a real enclave in an EC2 deployment.
 *
 * References:
 *   - Nautilus docs: https://docs.sui.io/guides/developer/advanced/nautilus
 *   - AWS Nitro Enclaves: https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclaves.html
 */
import { NextRequest, NextResponse } from "next/server";

// The PCR0 the PolicyCap was minted with — 48-byte SHA-384 hex string.
// In production this comes FROM the enclave, not the env.
// The env stores the EXPECTED value; the enclave PRODUCES the actual value.
// They must match for the Move assert! to pass.
const EXPECTED_PCR0 = (process.env.EXPECTED_PCR0 ?? "").replace(/"/g, "");

// In production, the enclave's local attestation endpoint
const ENCLAVE_ATTEST_URL = process.env.NAUTILUS_ENCLAVE_URL ?? null;

async function fetchRealPCR0(): Promise<string> {
  if (!ENCLAVE_ATTEST_URL) {
    throw new Error(
      "NAUTILUS_ENCLAVE_URL not set. This endpoint requires an AWS EC2 " +
        "instance with Nitro Enclave enabled. The enclave produces the PCR0 " +
        "measurement by hashing the signed enclave image (EIF). On a dev machine, " +
        "set EXPECTED_PCR0 in .env to use the pre-known enclave hash."
    );
  }

  // In production: the enclave exposes a local HTTP endpoint at the vsock address.
  // The response contains the AWS Nitro attestation document with PCR0.
  const resp = await fetch(`${ENCLAVE_ATTEST_URL}/attest`, {
    method: "GET",
    headers: { "X-Velo402-Request": "pcr0-measurement" },
  });

  if (!resp.ok) {
    throw new Error(
      `Enclave attestation failed: HTTP ${resp.status} from ${ENCLAVE_ATTEST_URL}`
    );
  }

  const data = await resp.json();

  // Nautilus attestation document structure:
  // { pcr0: "<hex>", pcr1: "<hex>", pcr2: "<hex>", document: "<base64-cbor>" }
  const pcr0 = data?.pcr0 as string | undefined;
  if (!pcr0 || pcr0.length < 96) {
    throw new Error(
      `Invalid PCR0 from enclave: expected 48-byte hex (96 chars), got: ${pcr0?.slice(0, 20)}...`
    );
  }

  // Verify the attestation matches what the PolicyCap expects
  if (pcr0.toLowerCase() !== EXPECTED_PCR0.toLowerCase()) {
    throw new Error(
      `PCR0 MISMATCH — enclave image may have been tampered with.\n` +
        `  Expected (from PolicyCap): ${EXPECTED_PCR0.slice(0, 16)}...\n` +
        `  Enclave produced:          ${pcr0.slice(0, 16)}...`
    );
  }

  return pcr0;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      verify?: boolean; // if true, verify the attestation matches EXPECTED_PCR0
    };

    let pcr0: string;
    let source: string;

    if (ENCLAVE_ATTEST_URL) {
      // Production path: contact the real Nitro Enclave
      pcr0 = await fetchRealPCR0();
      source = "aws_nitro_enclave";
    } else {
      // Development path: return the expected PCR0 from env
      // This is the value the PolicyCap was minted with.
      // A real deployment would fetch this FROM the enclave.
      if (!EXPECTED_PCR0 || EXPECTED_PCR0.length < 96) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Neither NAUTILUS_ENCLAVE_URL nor a valid EXPECTED_PCR0 (96-char hex) is set in .env. " +
              "Set NAUTILUS_ENCLAVE_URL to point to your EC2 Nitro Enclave vsock endpoint, " +
              "or set EXPECTED_PCR0 to the 48-byte SHA-384 hash of your enclave image for local development.",
            how_to_get_pcr0:
              "On an EC2 Nitro Enclave instance: `nitro-cli describe-enclaves` shows PCR0 after `nitro-cli run-enclave`.",
          },
          { status: 503 }
        );
      }
      pcr0 = EXPECTED_PCR0;
      source = "env_expected_pcr0_dev_mode";
    }

    return NextResponse.json({
      ok: true,
      pcr0,
      pcr0_bytes_length: pcr0.length / 2,
      source,
      policy_note:
        "Submit this pcr0 value in your PTB's nautilusAttestationHash field. " +
        "The Move contract verifies it matches policy.expected_pcr0 on-chain.",
      move_assert:
        "velo402::velo_wallet::pay_deepbook_spot checks attested_compute_required " +
        "and validates pcr0 against PolicyCap.expected_pcr0 at the Move layer.",
      production_deployment:
        ENCLAVE_ATTEST_URL
          ? `Connected to real enclave: ${ENCLAVE_ATTEST_URL}`
          : "Dev mode — set NAUTILUS_ENCLAVE_URL=http://<ec2-vsock-proxy>:8080 in .env for production.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// GET — returns the expected PCR0 and deployment instructions
export async function GET() {
  return NextResponse.json({
    endpoint: "POST /api/compute/attest",
    description: "Fetches the PCR0 Nautilus enclave attestation measurement.",
    production_setup: {
      step1: "Launch EC2 instance with Nitro Enclave support (e.g. c5.xlarge with enclave=true)",
      step2: "Build enclave image: `nitro-cli build-enclave --docker-uri velo402-agent --output-file agent.eif`",
      step3: "Run enclave: `nitro-cli run-enclave --eif-path agent.eif --cpu-count 2 --memory 512`",
      step4: "Get PCR0: `nitro-cli describe-enclaves | jq '.[0].Measurements.PCR0'`",
      step5: "Set EXPECTED_PCR0=<that value> in .env and mint a new PolicyCap with that PCR0",
      step6: "Set NAUTILUS_ENCLAVE_URL=http://localhost:8080 (vsock proxy) in .env",
      result: "This endpoint will then return the live PCR0 from the running enclave",
    },
    current_pcr0_configured: EXPECTED_PCR0
      ? `${EXPECTED_PCR0.slice(0, 16)}... (${EXPECTED_PCR0.length / 2} bytes)`
      : "NOT SET — add EXPECTED_PCR0 to .env",
    enclave_url_configured: ENCLAVE_ATTEST_URL ?? "NOT SET (dev mode)",
    on_chain_gate: {
      module: "velo402::velo_wallet",
      assertion: "attested_compute_required && expected_pcr0 check in pay_deepbook_* functions",
      package: process.env.NEXT_PUBLIC_VELO402_PACKAGE_ID ?? "see .env",
    },
  });
}
