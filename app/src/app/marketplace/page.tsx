"use client";
/**
 * app/marketplace/page.tsx — Knowledge Marketplace — Botanical Glassmorphism
 */
import { useEffect, useState } from "react";
import { mistToSui } from "@/lib/velo-constants";

const PRICE_MIST = BigInt(
  process.env.NEXT_PUBLIC_KNOWLEDGE_PRICE_MIST ?? "50000000",
);

interface Purchase {
  id: string;
  txDigest: string;
  amountMist: bigint;
  ts: number;
}

const FLOW_STEPS = [
  {
    icon: "lock",
    label: "Encrypt",
    desc: "Dataset encrypted with Seal threshold IBE — identity = request_hash. Blob stored on Walrus.",
    color: "var(--primary)",
  },
  {
    icon: "payments",
    label: "Pay",
    desc: "Agent pays the 402 invoice via pay_402_invoice PTB. AgentActionEvent emitted on-chain.",
    color: "var(--secondary)",
  },
  {
    icon: "verified",
    label: "Approve",
    desc: "Seal key servers dry-run seal_approve, verify on-chain payment, co-sign key share.",
    color: "var(--primary)",
  },
  {
    icon: "key",
    label: "Decrypt",
    desc: "Agent reconstructs key from 2-of-N shares, decrypts blob. No centralized gate-keeper.",
    color: "var(--secondary)",
  },
];

export default function MarketplacePage() {
  const [challenge, setChallenge] = useState<Record<string, unknown> | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [testing, setTesting] = useState(false);

  // ── Load historical purchases on mount + live stream new ones ──────────
  useEffect(() => {
    // Helper: convert action_type from either raw string or byte array
    function decodeActionType(raw: unknown): string {
      if (typeof raw === "string") return raw;
      if (Array.isArray(raw)) {
        try { return String.fromCharCode(...(raw as number[])); } catch { return ""; }
      }
      return String(raw ?? "");
    }

    function isDataPurchase(pj: any): boolean {
      const at = decodeActionType(pj?.action_type);
      return at.includes("402") || at.includes("DATA") || at.toLowerCase().includes("data");
    }

    // 1. Fetch historical events from the blockchain on mount
    const PACKAGE_ID = process.env.NEXT_PUBLIC_VELO402_PACKAGE_ID;
    if (PACKAGE_ID) {
      fetch(`/api/audit/stream`, { method: "HEAD" }); // warm up
      fetch("/api/policy/status")
        .then(r => r.json())
        .then(() => {
          // Pull historical AgentActionEvents directly
          return fetch(`/api/audit/stream`);
        })
        .catch(() => {});

      // Direct RPC fetch for historical purchases
      fetch("/api/stats/global")
        .then((r) => r.json())
        .then((stats) => {
          // stats.recentEvents should have the data — load into state
          if (Array.isArray(stats.recentEvents)) {
            const historical: Purchase[] = stats.recentEvents
              .filter((e: any) => e.eventType?.includes("AgentActionEvent") && isDataPurchase(e.parsedJson))
              .map((e: any) => ({
                id: e.txDigest,
                txDigest: e.txDigest,
                amountMist: BigInt(e.parsedJson?.amount ?? 50000000),
                ts: Number(e.timestampMs ?? Date.now()),
              }));
            if (historical.length > 0) {
              setPurchases(historical.slice(0, 50));
            }
          }
        })
        .catch(() => {});
    }

    // 2. Live stream new purchases via SSE
    const es = new EventSource("/api/audit/stream");
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "event" && data.eventType?.includes("AgentActionEvent")) {
        const pj = data.parsedJson as any;
        if (isDataPurchase(pj)) {
          setPurchases((prev) => {
            if (prev.find((p) => p.txDigest === data.txDigest)) return prev;
            return [
              {
                id: data.txDigest,
                txDigest: data.txDigest,
                amountMist: BigInt(pj.amount ?? 50000000),
                ts: Number(data.timestampMs ?? Date.now()),
              },
              ...prev,
            ].slice(0, 50);
          });
        }
      }
    };
    return () => es.close();
  }, []);

  const testEndpoint = async () => {
    setTesting(true);
    setChallenge(null);
    try {
      const res = await fetch("/api/knowledge/sentiment");
      const data = await res.json();
      setChallenge({ status: res.status, ...data });
    } catch (e) {
      setChallenge({ error: String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      {/* Page header */}
      <div className="fade-up" style={{ marginBottom: "1.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
          <span className="label-sm" style={{ color: "var(--secondary)", letterSpacing: "0.1em" }}>
            Encrypted Agent Data
          </span>
        </div>
        <h1 style={{ fontSize: "clamp(1.4rem, 3vw, 2rem)", fontWeight: 700 }}>
          Knowledge Marketplace
        </h1>
        <p style={{ color: "var(--on-surface-variant)", marginTop: "0.5rem", maxWidth: "560px" }}>
          Every dataset is encrypted on <strong style={{ color: "var(--primary)" }}>Walrus</strong> and
          access-gated by <strong style={{ color: "var(--primary)" }}>Seal</strong>. The agent pays 402
          invoices autonomously — no human in the data-purchase loop.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "1rem", alignItems: "start" }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Endpoint card */}
          <div
            className="glass-panel edge-light fade-up-2"
            style={{ borderRadius: "16px", padding: "1.75rem" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                flexWrap: "wrap",
                gap: "1rem",
                marginBottom: "1.25rem",
              }}
            >
              <div>
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                  <span className="badge badge-green">402 Gated</span>
                  <span className="badge badge-teal">Seal Encrypted</span>
                  <span className="badge badge-violet">Walrus Stored</span>
                </div>
                <h3 style={{ fontFamily: "'JetBrains Mono', monospace", marginBottom: "0.25rem" }}>
                  GET /api/knowledge/sentiment
                </h3>
                <div className="mono" style={{ fontSize: "0.78rem", color: "var(--on-surface-variant)" }}>
                  SUI/USDC market sentiment · {mistToSui(PRICE_MIST)} SUI per request
                </div>
              </div>
              <button
                id="testEndpointBtn"
                className="btn btn-primary"
                onClick={testEndpoint}
                disabled={testing}
                style={{ flexShrink: 0 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                  {testing ? "hourglass_top" : "play_arrow"}
                </span>
                {testing ? "Testing…" : "Test Endpoint"}
              </button>
            </div>

            {challenge && (
              <div
                style={{
                  marginTop: "0.25rem",
                  background: "rgba(0,23,17,0.5)",
                  borderRadius: "10px",
                  padding: "1rem",
                  border: `1px solid ${(challenge.status as number) === 402 ? "rgba(251,191,36,0.2)" : "rgba(161,212,148,0.2)"}`,
                }}
              >
                <div
                  style={{
                    color: (challenge.status as number) === 402 ? "#fbbf24" : "var(--primary)",
                    fontWeight: 700,
                    marginBottom: "0.5rem",
                    fontSize: "0.85rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                    {(challenge.status as number) === 402 ? "receipt" : "check_circle"}
                  </span>
                  HTTP {challenge.status as number}{" "}
                  {(challenge.status as number) === 402
                    ? "— 402 Challenge ✓"
                    : "— Payment Verified ✓"}
                </div>
                <pre
                  style={{
                    color: "var(--on-surface-variant)",
                    fontSize: "0.73rem",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {JSON.stringify(challenge, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* Purchase history */}
          <div
            className="glass-panel edge-light fade-up-3"
            style={{ borderRadius: "16px", padding: "1.75rem" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1rem",
              }}
            >
              <h3 style={{ fontSize: "1rem" }}>Purchase History</h3>
              <span style={{ fontSize: "0.72rem", color: "var(--outline)" }}>
                live from AgentActionEvent stream
              </span>
            </div>

            {purchases.length === 0 ? (
              <div
                className="terminal"
                style={{ textAlign: "center", color: "var(--outline)", padding: "2rem" }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "32px", display: "block", marginBottom: "0.5rem", opacity: 0.4 }}>
                  receipt_long
                </span>
                No purchases recorded yet.
                <br />
                <span style={{ fontSize: "0.72rem" }}>
                  Agent emits an event on every paid request.
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                {purchases.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      background: "rgba(0,23,17,0.4)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: "10px",
                      padding: "0.875rem 1rem",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "1rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div
                        className="mono"
                        style={{ fontSize: "0.75rem", color: "var(--primary)", marginBottom: "0.2rem" }}
                      >
                        {p.txDigest.slice(0, 24)}…
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "var(--on-surface-variant)" }}>
                        {new Date(p.ts).toLocaleTimeString()} · {mistToSui(p.amountMist)} SUI
                      </div>
                    </div>
                    <a
                      href={`https://testnet.suivision.xyz/txblock/${p.txDigest}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-ghost"
                      style={{ fontSize: "0.75rem", padding: "0.35rem 0.75rem" }}
                    >
                      Explorer ↗
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Flow card */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", position: "sticky", top: "100px" }}>
          <div
            className="glass-panel edge-light fade-up-2"
            style={{ borderRadius: "16px", padding: "1.5rem" }}
          >
            <div className="label-sm" style={{ marginBottom: "1.25rem" }}>
              Seal + Walrus Access Flow
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {FLOW_STEPS.map((step, i) => (
                <div key={step.label} style={{ display: "flex", gap: "1rem", paddingBottom: i < FLOW_STEPS.length - 1 ? "1.25rem" : 0 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
                    <div
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "50%",
                        background: `rgba(161,212,148,0.1)`,
                        border: `1px solid rgba(161,212,148,0.2)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "18px", color: step.color }}>
                        {step.icon}
                      </span>
                    </div>
                    {i < FLOW_STEPS.length - 1 && (
                      <div style={{ width: "1px", flex: 1, background: "rgba(255,255,255,0.06)", minHeight: "20px" }} />
                    )}
                  </div>
                  <div style={{ paddingTop: "0.4rem", paddingBottom: "0.5rem" }}>
                    <div style={{ fontSize: "0.8rem", fontWeight: 700, color: step.color, marginBottom: "0.25rem" }}>
                      {step.label}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--on-surface-variant)", lineHeight: 1.5 }}>
                      {step.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            className="terminal-panel fade-up-3"
            style={{ borderRadius: "16px", padding: "1.25rem" }}
          >
            <div className="label-sm" style={{ marginBottom: "0.75rem", color: "var(--primary)" }}>
              Pricing
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--on-surface-variant)" }}>Per Request</span>
              <span className="mono" style={{ fontSize: "1rem", fontWeight: 700, color: "var(--primary)" }}>
                {mistToSui(PRICE_MIST)} SUI
              </span>
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--outline)" }}>
              Paid autonomously by the agent. Verified by PolicyCap scope check.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
