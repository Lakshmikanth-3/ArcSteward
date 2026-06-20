"use client";
/**
 * app/dashboard/page.tsx — Mission Control (Home)
 *
 * Live gauges fed directly from on-chain state via API routes:
 *   • /api/policy/status  → PolicyCap spend/remaining/expiry/scopes
 *   • /api/treasury/yield/status → Treasury balance, Scallop APY, Pyth SUI/USD
 *   • /api/audit/stream   → Server-Sent Events (AgentActionEvent, yield events)
 *
 * Zero mocks, zero placeholders. Every number is chain-sourced or Pyth-sourced.
 */
import { useEffect, useRef, useState } from "react";
import { mistToSui, SCOPE_LABEL, ACTION_LABEL } from "@/lib/velo-constants";

// ─── Types ────────────────────────────────────────────────────────────────────
interface PolicyStatus {
  ok: boolean;
  policy: {
    id: string;
    exists: boolean;
    maxSpend: string;
    currentSpend: string;
    remainingBudget: string;
    expirationEpoch: number;
    allowedScopes: number[];
    attestedComputeRequired: boolean;
  };
  policies?: {
    id: string;
    exists: boolean;
    maxSpend: string;
    currentSpend: string;
    remainingBudget: string;
    expirationEpoch: number;
    allowedScopes: number[];
    attestedComputeRequired: boolean;
  }[];
  treasury: { balanceMist: string; label: string; id: string };
  currentEpoch: number;
  epochsRemaining: number;
}

interface YieldStatus {
  principal_mist: string;
  yield_position_mist: string;
  accrued_yield_mist: string;
  apy_bps: number;
  runway_extension_invoices: number;
  exchange_rate: number;
  balance_usd: string;
  stale: boolean;
  error?: string;
}

interface AuditEvent {
  id: string;
  type: string;
  eventType: string;
  txDigest: string;
  timestampMs: string;
  parsedJson: Record<string, unknown>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function pct(used: string, max: string): number {
  const u = Number(used);
  const m = Number(max);
  if (m === 0) return 0;
  return Math.min(100, (u / m) * 100);
}

function eventToSentence(evt: AuditEvent): string {
  const pj = evt.parsedJson as any;
  const actionRaw = Array.isArray(pj?.action_type)
    ? String.fromCharCode(...pj.action_type)
    : String(pj?.action_type ?? "");
  const label = ACTION_LABEL[actionRaw] ?? actionRaw;
  const amtSui = pj?.amount ? mistToSui(BigInt(pj.amount)) : null;
  const ts = evt.timestampMs
    ? new Date(Number(evt.timestampMs)).toLocaleTimeString()
    : "";
  if (amtSui) return `${ts}  Agent ${label} · ${amtSui} SUI`;
  return `${ts}  ${label}`;
}

function scopeColor(tag: number): string {
  if (tag === 1) return "var(--primary)";
  if (tag === 2) return "#818cf8";
  if (tag === 3) return "#a78bfa";
  if (tag === 4) return "#fb923c";
  return "var(--on-surface-variant)";
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [policy, setPolicy] = useState<PolicyStatus | null>(null);
  const [yieldData, setYieldData] = useState<YieldStatus | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [policyErr, setPolicyErr] = useState("");
  const [yieldErr, setYieldErr] = useState("");
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<{ ok: boolean; digest?: string; error?: string } | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [revoking, setRevoking] = useState<Record<string, boolean>>({});
  const [revokeResult, setRevokeResult] = useState<Record<string, string>>({});

  // Load agent names from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = JSON.parse(localStorage.getItem("velo402_agent_names") ?? "{}");
      setAgentNames(stored);
    }
  }, []);

  const handleRevoke = async (policyCapId: string) => {
    if (!confirm(`Permanently revoke this agent (${policyCapId.slice(0, 10)}…)? This CANNOT be undone.`)) return;
    setRevoking((p) => ({ ...p, [policyCapId]: true }));
    try {
      const res = await fetch("/api/owner/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyCapId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Revoke failed");
      // Remove name from localStorage
      const stored: Record<string, string> = JSON.parse(localStorage.getItem("velo402_agent_names") ?? "{}");
      delete stored[policyCapId];
      localStorage.setItem("velo402_agent_names", JSON.stringify(stored));
      setAgentNames(stored);
      setRevokeResult((p) => ({ ...p, [policyCapId]: data.digest }));
    } catch (e) {
      alert("Revoke failed: " + String(e));
    } finally {
      setRevoking((p) => ({ ...p, [policyCapId]: false }));
    }
  };

  // ── Fetch policy + yield in parallel on mount ────────────────────────────
  useEffect(() => {
    async function load() {
      const [pRes, yRes] = await Promise.allSettled([
        fetch("/api/policy/status").then((r) => r.json()),
        fetch("/api/treasury/yield/status").then((r) => r.json()),
      ]);
      if (pRes.status === "fulfilled") {
        if (pRes.value.error) setPolicyErr(pRes.value.error);
        else setPolicy(pRes.value);
      } else setPolicyErr("Could not reach /api/policy/status");
      if (yRes.status === "fulfilled") {
        if (yRes.value.error) setYieldErr(yRes.value.error);
        else setYieldData(yRes.value);
      } else setYieldErr("Could not reach /api/treasury/yield/status");
    }
    load();
    // Refresh every 15 s
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  // ── Live audit stream via SSE ────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource("/api/audit/stream");
    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as AuditEvent & { type: string };
      if (data.type !== "event") return;
      setEvents((prev) => {
        if (prev.find((p) => p.txDigest === data.txDigest && p.eventType === data.eventType))
          return prev;
        return [{ ...data, id: data.txDigest + data.eventType } as AuditEvent, ...prev].slice(0, 80);
      });
    };
    return () => es.close();
  }, []);

  // ── Auto-scroll feed to top on new events ───────────────────────────────
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = 0;
  }, [events.length]);

  // ── Yield sweep ──────────────────────────────────────────────────────────
  async function handleSweep() {
    setSweeping(true);
    setSweepResult(null);
    try {
      const res = await fetch("/api/treasury/yield/sweep", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
      const d = await res.json();
      setSweepResult(d);
      if (d.ok) {
        // Refresh yield data after sweep
        setTimeout(() => fetch("/api/treasury/yield/status").then(r => r.json()).then(setYieldData), 3000);
      }
    } catch (e) {
      setSweepResult({ ok: false, error: String(e) });
    } finally {
      setSweeping(false);
    }
  }

  // ── Derived values ───────────────────────────────────────────────────────
  const spendPct = policy ? pct(policy.policy.currentSpend, policy.policy.maxSpend) : 0;
  const maxSui = policy ? mistToSui(BigInt(policy.policy.maxSpend)) : "—";
  const spentSui = policy ? mistToSui(BigInt(policy.policy.currentSpend)) : "—";
  const remainingSui = policy ? mistToSui(BigInt(policy.policy.remainingBudget)) : "—";
  const apyPct = yieldData && !yieldData.error ? (yieldData.apy_bps / 100).toFixed(2) : "—";
  const suiUsd = yieldData?.balance_usd ?? "—";
  const invoicesCoverable = yieldData?.runway_extension_invoices ?? "—";
  const treasuryBalanceSui = yieldData && !yieldData.error
    ? (Number(yieldData.principal_mist) / 1e9).toFixed(4)
    : policy?.treasury.balanceMist
      ? mistToSui(BigInt(policy!.treasury.balanceMist))
      : "—";

  return (
    <div>
      {/* ── Header ── */}
      <div className="fade-up" style={{ marginBottom: "1.75rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="title text-glow">Mission Control</h1>
          <p className="subtitle">
            Live telemetry and active policy metrics for your autonomous wallet.
          </p>
        </div>
        {policy && (
          <div style={{ textAlign: "right", background: "#fff", padding: "4px", borderRadius: "8px" }}>
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=https://testnet.suivision.xyz/object/${policy.policy.id}`} alt="SuiVision QR" width={80} height={80} style={{ display: 'block', borderRadius: '4px' }} />
          </div>
        )}
      </div>

      {/* ── Error banners ── */}
      {policyErr && (
        <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "rgba(147,0,10,0.1)", border: "1px solid rgba(255,180,171,0.2)", color: "var(--error)", fontFamily: "monospace", fontSize: "0.82rem", marginBottom: "1rem" }}>
          ✗ Policy RPC error: {policyErr}
        </div>
      )}

      {/* ── Top stat row ── */}
      <div className="stat-grid fade-up-2" style={{ marginBottom: "1rem" }}>
        {[
          {
            label: "Remaining Budget",
            value: `${remainingSui} SUI`,
            sub: `of ${maxSui} SUI ceiling`,
            icon: "account_balance_wallet",
            color: "var(--primary)",
          },
          {
            label: "Spent",
            value: `${spentSui} SUI`,
            sub: `${spendPct.toFixed(1)}% of ceiling consumed`,
            icon: "payments",
            color: spendPct > 90 ? "var(--error)" : "var(--secondary)",
          },
          {
            label: "Treasury Balance",
            value: `${treasuryBalanceSui} SUI`,
            sub: suiUsd !== "—" ? `≈ $${(Number(treasuryBalanceSui) * Number(suiUsd)).toFixed(2)} USD` : "Pyth feed loading…",
            icon: "savings",
            color: "var(--primary)",
          },
          {
            label: "Epochs to Expiry",
            value: policy ? String(policy.epochsRemaining) : "—",
            sub: policy ? `Expires epoch #${policy.policy.expirationEpoch}` : "Loading…",
            icon: "schedule",
            color: policy && policy.epochsRemaining < 5 ? "#fbbf24" : "var(--on-surface)",
          },
        ].map(({ label, value, sub, icon, color }) => (
          <div key={label} className="stat-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
              <div className="stat-label">{label}</div>
              <span className="material-symbols-outlined" style={{ fontSize: "18px", color, opacity: 0.7 }}>
                {icon}
              </span>
            </div>
            <div className="stat-value mono" style={{ color }}>{value}</div>
            <div className="stat-sub">{sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "1rem", alignItems: "start" }}>
        {/* ── Left column ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

          {/* PolicyCap Swarm */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
            {policy?.policies && policy.policies.length > 0 ? (
              policy.policies.map((pol, idx) => {
              const pSpendPct = pct(pol.currentSpend, pol.maxSpend);
              const pMaxSui = mistToSui(BigInt(pol.maxSpend));
              const pSpentSui = mistToSui(BigInt(pol.currentSpend));

              return (
                <div key={pol.id} className="glass-panel edge-light fade-up-2" style={{ borderRadius: "16px", padding: "1.5rem", marginBottom: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
                    <h3 style={{ fontSize: "1rem" }}>{agentNames[pol.id] ?? `Agent ${idx + 1}`}</h3>
                    {pol.attestedComputeRequired && (
                      <span className="badge badge-violet">🔒 TEE Required</span>
                    )}
                  </div>

                  {/* Spend bar */}
                  <div style={{ marginBottom: "1.25rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", color: "var(--on-surface-variant)", marginBottom: "0.4rem" }}>
                      <span>Consumed: <span className="mono" style={{ color: pSpendPct > 90 ? "var(--error)" : "var(--primary)" }}>{pSpendPct.toFixed(1)}%</span></span>
                      <span>{pSpentSui} / {pMaxSui} SUI</span>
                    </div>
                    <div className="progress-track">
                      <div
                        className={`progress-fill ${pSpendPct > 90 ? "red" : pSpendPct > 70 ? "amber" : "emerald"}`}
                        style={{ width: `${pSpendPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Authorized scopes */}
                  <div>
                    <div className="label" style={{ marginBottom: "0.6rem" }}>Authorized Scopes</div>
                    <div className="scope-grid">
                      {pol.allowedScopes.length
                        ? pol.allowedScopes.map((tag) => (
                            <span
                              key={tag}
                              className={`scope-chip active-${tag}`}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                                {tag === 1 ? "data_object" : tag === 2 ? "show_chart" : tag === 3 ? "trending_up" : "psychology"}
                              </span>
                              {SCOPE_LABEL[tag] ?? `Scope ${tag}`}
                            </span>
                          ))
                        : <span style={{ color: "var(--outline)", fontSize: "0.8rem" }}>No scopes</span>}
                    </div>
                  </div>

                  {/* PolicyCap ID */}
                  <div style={{ marginTop: "1rem" }}>
                    <div className="label" style={{ marginBottom: "0.3rem" }}>PolicyCap Object</div>
                    <a
                      href={`https://testnet.suivision.xyz/object/${pol.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mono"
                      style={{ fontSize: "0.68rem", color: "var(--outline)", wordBreak: "break-all", textDecoration: "none" }}
                    >
                      {pol.id} ↗
                    </a>
                  </div>

                  {/* Revoke button */}
                  <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end" }}>
                    {revokeResult[pol.id] ? (
                      <a
                        href={`https://testnet.suivision.xyz/txblock/${revokeResult[pol.id]}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: "0.72rem", color: "var(--error)", textDecoration: "underline" }}
                      >
                        ✓ Revoked — View Tx
                      </a>
                    ) : (
                      <button
                        onClick={() => handleRevoke(pol.id)}
                        disabled={revoking[pol.id]}
                        style={{
                          fontSize: "0.72rem",
                          padding: "0.3rem 0.75rem",
                          borderRadius: "6px",
                          border: "1px solid rgba(255,180,171,0.25)",
                          background: "rgba(147,0,10,0.08)",
                          color: revoking[pol.id] ? "var(--outline)" : "var(--error)",
                          cursor: revoking[pol.id] ? "not-allowed" : "pointer",
                        }}
                      >
                        {revoking[pol.id] ? "Revoking…" : "⚡ Revoke Agent"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="glass-panel edge-light fade-up-2" style={{ borderRadius: "16px", padding: "1.5rem", gridColumn: "1 / -1" }}>
              <div style={{ color: "var(--outline)" }}>Loading Agents...</div>
            </div>
          )}
          </div>

          {/* Yield Gauge */}
          <div className="glass-panel edge-light fade-up-3" style={{ borderRadius: "16px", padding: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h3 style={{ fontSize: "1rem" }}>Yield Gauge — Scallop Money Market</h3>
              <button
                id="sweepYieldBtn"
                className="btn btn-ghost"
                onClick={handleSweep}
                disabled={sweeping}
                style={{ fontSize: "0.75rem", padding: "0.4rem 0.9rem" }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>
                  {sweeping ? "hourglass_top" : "sync"}
                </span>
                {sweeping ? "Sweeping…" : "Sweep to Yield"}
              </button>
            </div>

            {yieldErr && (
              <div style={{ color: "var(--error)", fontSize: "0.8rem", fontFamily: "monospace", marginBottom: "0.75rem" }}>
                ✗ {yieldErr}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
              {[
                { label: "Treasury Balance", value: treasuryBalanceSui !== "—" ? `${treasuryBalanceSui} SUI` : "—", sub: suiUsd !== "—" ? `$${suiUsd}` : "" },
                { label: "Scallop APY", value: apyPct !== "—" ? `${apyPct}%` : "—", sub: "Live from Scallop SDK" },
                { label: "Runway Ext.", value: String(invoicesCoverable), sub: "Bonus invoices covered" },
              ].map(({ label, value, sub }) => (
                <div key={label} style={{ textAlign: "center" }}>
                  <div className="label" style={{ marginBottom: "0.25rem" }}>{label}</div>
                  <div className="mono" style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--primary)" }}>{value}</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--outline)", marginTop: "0.1rem" }}>{sub}</div>
                </div>
              ))}
            </div>

            {/* Sweep result */}
            {sweepResult && (
              <div style={{
                marginTop: "1rem",
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                background: sweepResult.ok ? "rgba(161,212,148,0.06)" : "rgba(147,0,10,0.08)",
                border: `1px solid ${sweepResult.ok ? "rgba(161,212,148,0.2)" : "rgba(255,180,171,0.2)"}`,
                fontFamily: "monospace",
                fontSize: "0.78rem",
                color: sweepResult.ok ? "var(--primary)" : "var(--error)",
              }}>
                {sweepResult.ok
                  ? `✓ Swept to Scallop — digest: ${sweepResult.digest?.slice(0, 24)}…`
                  : `✗ ${sweepResult.error}`}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Live Audit Feed ── */}
        <div style={{ position: "sticky", top: "100px" }}>
          <div className="terminal-panel fade-up-2" style={{ borderRadius: "16px" }}>
            {/* Terminal chrome */}
            <div style={{
              padding: "0.75rem 1rem",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div style={{ display: "flex", gap: "5px" }}>
                  {["rgba(255,100,100,0.2)", "rgba(255,200,100,0.2)", "rgba(100,255,150,0.2)"].map((bg, i) => (
                    <div key={i} style={{ width: "10px", height: "10px", borderRadius: "50%", background: bg, border: `1px solid ${bg.replace("0.2", "0.4")}` }} />
                  ))}
                </div>
                <span className="mono" style={{ fontSize: "0.65rem", color: "var(--on-surface-variant)", textTransform: "uppercase", marginLeft: "0.5rem" }}>
                  Audit Feed — AgentActionEvent
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span className="pulse-dot live" />
                <span className="mono" style={{ fontSize: "0.65rem", color: "var(--primary)" }}>{events.length} events</span>
              </div>
            </div>

            {/* Feed */}
            <div
              ref={feedRef}
              className="terminal"
              style={{ border: "none", background: "transparent", maxHeight: "520px", borderRadius: 0, borderBottomLeftRadius: "16px", borderBottomRightRadius: "16px" }}
            >
              {events.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--outline)", padding: "3rem 1rem" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: "36px", display: "block", marginBottom: "0.5rem", opacity: 0.3 }}>
                    monitor_heart
                  </span>
                  Waiting for on-chain events…
                  <br />
                  <span style={{ fontSize: "0.72rem" }}>Stream connected. Events appear here in real time.</span>
                </div>
              ) : (
                events.map((evt) => {
                  const pj = evt.parsedJson as any;
                  const scopeTag = Number(pj?.scope_tag ?? pj?.allowed_scopes?.[0] ?? 0);
                  const actionRaw = Array.isArray(pj?.action_type)
                    ? String.fromCharCode(...pj.action_type)
                    : String(pj?.action_type ?? evt.eventType.split("::").pop() ?? "");
                  const isYield = evt.eventType?.includes("Yield");
                  const isRevoke = evt.eventType?.includes("Revoked");

                  return (
                    <div key={evt.id} className="term-line">
                      <span className="term-ts">
                        {evt.timestampMs ? new Date(Number(evt.timestampMs)).toLocaleTimeString() : "—"}
                      </span>
                      <span
                        className={`term-tag ${isRevoke ? "revoke" : isYield ? "system" : scopeTag === 1 ? "data" : scopeTag === 2 ? "spot" : scopeTag === 3 ? "margin" : "predict"}`}
                      >
                        {isRevoke ? "REVOKE" : isYield ? "YIELD" : SCOPE_LABEL[scopeTag] ?? "EVENT"}
                      </span>
                      <span className="term-msg">
                        {ACTION_LABEL[actionRaw] ?? actionRaw}
                        {pj?.amount && ` · ${mistToSui(BigInt(pj.amount))} SUI`}
                        {" "}
                        <a
                          href={`https://testnet.suivision.xyz/txblock/${evt.txDigest}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--outline)", fontSize: "0.68rem" }}
                        >
                          {evt.txDigest.slice(0, 10)}…
                        </a>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
