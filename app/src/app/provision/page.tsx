"use client";
/**
 * app/provision/page.tsx — Mandate Builder — Botanical Glassmorphism Redesign
 */
import { useState } from "react";
import { SCOPE, SCOPE_LABEL } from "@/lib/velo-constants";
import { mistToSui, suiToMist } from "@/lib/velo-constants";

const SCOPE_LIST = [
  {
    id: SCOPE.DATA_402,
    label: SCOPE_LABEL[SCOPE.DATA_402],
    desc: "Pay HTTP 402 invoices to Knowledge Agents",
    icon: "data_object",
  },
  {
    id: SCOPE.DEEPBOOK_SPOT,
    label: SCOPE_LABEL[SCOPE.DEEPBOOK_SPOT],
    desc: "Execute Spot limit orders on DeepBook",
    icon: "show_chart",
  },
  {
    id: SCOPE.DEEPBOOK_MARGIN,
    label: SCOPE_LABEL[SCOPE.DEEPBOOK_MARGIN],
    desc: "Leveraged Margin orders on DeepBook v3",
    icon: "trending_up",
  },
  {
    id: SCOPE.DEEPBOOK_PREDICT,
    label: SCOPE_LABEL[SCOPE.DEEPBOOK_PREDICT],
    desc: "Binary / range Predict positions",
    icon: "psychology",
  },
];

interface IntentPreview {
  ok: boolean;
  original_text: string;
  parsed_intent: {
    action: string;
    scope_tag: number;
    amount_sui: number;
    rationale: string;
  };
  preview: {
    action: string;
    venue: string;
    cost_breakdown: string;
    budget_impact: string;
    risk_summary: string;
    guardian_summary: string;
    can_execute: boolean;
  };
  guardian: {
    risk_level: string;
    blocks: string[];
    warnings: string[];
  };
  error?: string;
  message?: string;
}

export default function ProvisionPage() {
  const [budget, setBudget] = useState(1);
  const [expiryDays, setExpiryDays] = useState(1);
  const [scopes, setScopes] = useState<number[]>([
    SCOPE.DATA_402,
    SCOPE.DEEPBOOK_SPOT,
  ]);
  const [attested, setAttested] = useState(false);
  const [ownerCapId, setOwnerCapId] = useState("");
  const [agentAddr, setAgentAddr] = useState("");
  const [currentEpoch, setCurrentEpoch] = useState(0);
  const [result, setResult] = useState<{
    txBytes: string;
    summary: object;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // ── Intent parser state ──────────────────────────────────────────────────
  const [intentText, setIntentText] = useState("");
  const [intentParsing, setIntentParsing] = useState(false);
  const [intentPreview, setIntentPreview] = useState<IntentPreview | null>(null);
  const [intentErr, setIntentErr] = useState("");

  const handleParseIntent = async () => {
    if (!intentText.trim()) return;
    setIntentParsing(true);
    setIntentPreview(null);
    setIntentErr("");
    try {
      const res = await fetch("/api/intent/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: intentText }),
      });
      const data: IntentPreview = await res.json();
      if (!res.ok || data.error) {
        setIntentErr(data.message ?? data.error ?? "Parse failed");
      } else {
        setIntentPreview(data);
        // Auto-populate form fields from parsed intent
        if (data.parsed_intent.amount_sui > 0) {
          setBudget(Math.min(50, Math.max(0.01, data.parsed_intent.amount_sui)));
        }
        if (data.parsed_intent.scope_tag && !scopes.includes(data.parsed_intent.scope_tag)) {
          setScopes((prev) => [...prev, data.parsed_intent.scope_tag]);
        }
      }
    } catch (e) {
      setIntentErr(String(e));
    } finally {
      setIntentParsing(false);
    }
  };

  const expirationEpoch = currentEpoch + expiryDays;

  const toggleScope = (id: number) => {
    setScopes((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const handleBuild = async () => {
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/agent/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerCapId,
          maxSpendSui: budget,
          expirationEpoch,
          allowedScopes: scopes,
          attestedComputeRequired: attested,
          agentAddress: agentAddr,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unknown error");
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const budgetPct = ((budget - 0.01) / (50 - 0.01)) * 100;
  const expiryPct = ((expiryDays - 1) / (30 - 1)) * 100;

  return (
    <div style={{ maxWidth: "860px" }}>
      {/* Page header */}
      <div className="fade-up" style={{ marginBottom: "1.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
          <span className="label-sm" style={{ color: "var(--secondary)", letterSpacing: "0.1em" }}>
            Agent Configuration
          </span>
        </div>
        <h1 style={{ fontSize: "clamp(1.4rem, 3vw, 2rem)", fontWeight: 700 }}>
          Provision Agent
        </h1>
        <p style={{ color: "var(--on-surface-variant)", marginTop: "0.5rem", maxWidth: "520px" }}>
          Mint a{" "}
          <span className="mono" style={{ color: "var(--primary)" }}>
            PolicyCap
          </span>{" "}
          with a spend ceiling, expiry, and allowed protocol scope. Sign once —
          the agent operates autonomously within these bounds until you revoke.
        </p>
      </div>

      {/* ── Intent Parser Box ── */}
      <div
        className="glass-panel edge-light fade-up-2"
        style={{ borderRadius: "16px", padding: "1.5rem", marginBottom: "1rem" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "18px", color: "var(--secondary)" }}>
            auto_fix_high
          </span>
          <span style={{ fontSize: "0.875rem", fontWeight: 700 }}>
            Plain-English Intent Parser
          </span>
          <span className="badge badge-teal" style={{ marginLeft: "auto" }}>Guardian pre-flight included</span>
        </div>
        <p style={{ fontSize: "0.78rem", color: "var(--on-surface-variant)", marginBottom: "0.75rem" }}>
          Describe what you want the agent to do. The intent is parsed, Guardian-checked, and the mandate form is pre-filled.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
          <textarea
            id="intentInput"
            className="input"
            placeholder='e.g. "Let this agent buy sentiment data and place small Predict bets, capped at 2 SUI, for 7 days"'
            value={intentText}
            onChange={(e) => setIntentText(e.target.value)}
            style={{ resize: "vertical", minHeight: "60px", flex: 1, fontFamily: "inherit" }}
            onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) handleParseIntent(); }}
          />
          <button
            id="parseIntentBtn"
            className="btn btn-primary"
            onClick={handleParseIntent}
            disabled={intentParsing || !intentText.trim()}
            style={{ flexShrink: 0, alignSelf: "flex-start" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
              {intentParsing ? "hourglass_top" : "send"}
            </span>
            {intentParsing ? "Parsing…" : "Parse"}
          </button>
        </div>

        {intentErr && (
          <div style={{ marginTop: "0.75rem", padding: "0.6rem 0.9rem", borderRadius: "8px", background: "rgba(147,0,10,0.08)", border: "1px solid rgba(255,180,171,0.2)", color: "var(--error)", fontSize: "0.8rem", fontFamily: "monospace" }}>
            ✗ {intentErr}
          </div>
        )}

        {intentPreview && (
          <div style={{ marginTop: "0.75rem", padding: "1rem", borderRadius: "10px", background: "rgba(161,212,148,0.04)", border: "1px solid rgba(161,212,148,0.15)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <span
                className={`badge ${intentPreview.guardian.blocks.length ? "badge-red" : intentPreview.guardian.warnings.length ? "badge-amber" : "badge-green"}`}
              >
                Guardian: {intentPreview.guardian.risk_level}
              </span>
              {intentPreview.guardian.blocks.map((b) => (
                <span key={b} className="badge badge-red">{b}</span>
              ))}
              {intentPreview.guardian.warnings.map((w) => (
                <span key={w} className="badge badge-amber">{w}</span>
              ))}
            </div>
            {[
              ["Action", intentPreview.preview.action],
              ["Venue", intentPreview.preview.venue],
              ["Cost", intentPreview.preview.cost_breakdown],
              ["Budget Impact", intentPreview.preview.budget_impact],
              ["Guardian", intentPreview.preview.guardian_summary],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: "0.5rem", fontSize: "0.78rem" }}>
                <span style={{ color: "var(--outline)", width: "90px", flexShrink: 0 }}>{k}</span>
                <span style={{ color: "var(--on-surface)" }}>{v}</span>
              </div>
            ))}
            <div style={{ fontSize: "0.72rem", color: "var(--outline)", marginTop: "0.25rem" }}>
              ✓ Form pre-filled from parsed intent. Adjust sliders as needed, then build the policy.
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "1rem", alignItems: "start" }}>
        {/* Main form */}
        <div
          className="glass-panel edge-light fade-up-2"
          style={{ borderRadius: "16px", padding: "2rem", display: "flex", flexDirection: "column", gap: "1.75rem" }}
        >
          {/* Owner Cap ID */}
          <div>
            <label className="label">OwnerCap Object ID</label>
            <input
              id="ownerCapId"
              className="input mono"
              placeholder="0x…"
              value={ownerCapId}
              onChange={(e) => setOwnerCapId(e.target.value)}
            />
            <p style={{ fontSize: "0.73rem", color: "var(--outline)", marginTop: "0.4rem" }}>
              Your OwnerCap object minted when the Treasury was created.
            </p>
          </div>

          {/* Agent address */}
          <div>
            <label className="label">Agent Keypair Address</label>
            <input
              id="agentAddress"
              className="input mono"
              placeholder="0x…"
              value={agentAddr}
              onChange={(e) => setAgentAddr(e.target.value)}
            />
            <p style={{ fontSize: "0.73rem", color: "var(--outline)", marginTop: "0.4rem" }}>
              The throwaway Ed25519 address the agent controls. Does <em>not</em>{" "}
              hold treasury funds.
            </p>
          </div>

          {/* Budget slider */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.6rem" }}>
              <label className="label" style={{ marginBottom: 0 }}>Budget Ceiling</label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span className="mono" style={{ fontSize: "1rem", fontWeight: 700, color: "var(--primary)" }}>
                  {budget} SUI
                </span>
                <span style={{ fontSize: "0.7rem", color: "var(--outline)" }}>
                  ({suiToMist(budget).toString()} MIST)
                </span>
              </div>
            </div>
            <input
              id="budgetSlider"
              type="range"
              min={0.01}
              max={50}
              step={0.01}
              value={budget}
              onChange={(e) => setBudget(parseFloat(e.target.value))}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "var(--outline)", marginTop: "0.3rem" }}>
              <span>0.01 SUI</span>
              <span>50 SUI</span>
            </div>
          </div>

          {/* Expiry slider */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.6rem" }}>
              <label className="label" style={{ marginBottom: 0 }}>Expiry Window</label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span className="mono" style={{ fontSize: "1rem", fontWeight: 700, color: "var(--primary)" }}>
                  {expiryDays} day{expiryDays !== 1 ? "s" : ""}
                </span>
                <span style={{ fontSize: "0.7rem", color: "var(--outline)" }}>
                  ≈ epoch {expirationEpoch}
                </span>
              </div>
            </div>
            <input
              id="expirySlider"
              type="range"
              min={1}
              max={30}
              step={1}
              value={expiryDays}
              onChange={(e) => setExpiryDays(parseInt(e.target.value))}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "var(--outline)", marginTop: "0.3rem" }}>
              <span>1 day</span>
              <span>30 days</span>
            </div>
          </div>

          {/* Current epoch input */}
          <div>
            <label className="label">Current Epoch (from Mission Control)</label>
            <input
              id="currentEpoch"
              className="input mono"
              type="number"
              placeholder="e.g. 420"
              value={currentEpoch || ""}
              onChange={(e) => setCurrentEpoch(parseInt(e.target.value) || 0)}
            />
          </div>

          {/* Scope selector */}
          <div>
            <label className="label" style={{ marginBottom: "0.75rem" }}>
              Authorized Protocol Scopes
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {SCOPE_LIST.map((s) => {
                const isActive = scopes.includes(s.id);
                return (
                  <button
                    key={s.id}
                    id={`scope-${s.id}`}
                    onClick={() => toggleScope(s.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.875rem 1rem",
                      borderRadius: "10px",
                      border: isActive
                        ? "1px solid rgba(161,212,148,0.3)"
                        : "1px solid var(--outline-variant)",
                      background: isActive
                        ? "rgba(161,212,148,0.08)"
                        : "rgba(0,23,17,0.4)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.2s",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{
                        fontSize: "20px",
                        color: isActive ? "var(--primary)" : "var(--outline)",
                      }}
                    >
                      {s.icon}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "0.875rem", fontWeight: 600, color: isActive ? "var(--primary)" : "var(--on-surface)", marginBottom: "0.1rem" }}>
                        {s.label}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--outline)" }}>
                        {s.desc}
                      </div>
                    </div>
                    <div
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "50%",
                        border: isActive ? "none" : "2px solid var(--outline-variant)",
                        background: isActive ? "var(--primary)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        transition: "all 0.2s",
                      }}
                    >
                      {isActive && (
                        <span className="material-symbols-outlined" style={{ fontSize: "14px", color: "var(--on-primary)" }}>
                          check
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Nautilus toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <label className="label" style={{ marginBottom: "0.2rem" }}>
                Require Nautilus Attestation
              </label>
              <p style={{ fontSize: "0.73rem", color: "var(--outline)" }}>
                Enforces TEE verification before every trade execution.
              </p>
            </div>
            <button
              id="attestationToggle"
              onClick={() => setAttested(!attested)}
              style={{
                width: "48px",
                height: "26px",
                borderRadius: "999px",
                background: attested ? "var(--primary)" : "rgba(255,255,255,0.1)",
                border: "none",
                cursor: "pointer",
                position: "relative",
                transition: "background 0.2s",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: "3px",
                  left: attested ? "24px" : "3px",
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  background: "#fff",
                  transition: "left 0.2s",
                }}
              />
            </button>
          </div>

          {attested && (
            <div style={{ marginTop: "-1rem" }}>
              <span className="badge badge-violet">🔒 TEE Required</span>
            </div>
          )}

          {error && (
            <div
              style={{
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                background: "rgba(147,0,10,0.1)",
                border: "1px solid rgba(255,180,171,0.2)",
                color: "var(--error)",
                fontFamily: "monospace",
                fontSize: "0.85rem",
              }}
            >
              ✗ {error}
            </div>
          )}

          <button
            id="buildPolicyBtn"
            className="btn btn-primary"
            onClick={handleBuild}
            disabled={loading || !ownerCapId || !agentAddr || scopes.length === 0}
            style={{ alignSelf: "flex-start", padding: "0.75rem 1.75rem" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
              {loading ? "hourglass_top" : "bolt"}
            </span>
            {loading ? "Building PTB…" : "Build & Sign Policy Transaction"}
          </button>

          {result && (
            <div
              style={{
                padding: "1rem 1.25rem",
                borderRadius: "10px",
                background: "rgba(161,212,148,0.06)",
                border: "1px solid rgba(161,212,148,0.2)",
              }}
            >
              <div style={{ color: "var(--primary)", fontWeight: 700, marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>check_circle</span>
                PTB Built Successfully
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--on-surface-variant)", marginBottom: "0.75rem" }}>
                Submit these bytes via Sui CLI or your wallet adapter:
              </p>
              <pre
                style={{
                  fontSize: "0.7rem",
                  fontFamily: "monospace",
                  color: "var(--on-surface-variant)",
                  wordBreak: "break-all",
                  whiteSpace: "pre-wrap",
                  maxHeight: "140px",
                  overflow: "auto",
                  background: "rgba(0,23,17,0.5)",
                  padding: "0.75rem",
                  borderRadius: "8px",
                }}
              >
                sui client execute-signed-tx --tx-bytes{" "}
                {result.txBytes.slice(0, 80)}…
              </pre>
            </div>
          )}
        </div>

        {/* Right: live preview */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", position: "sticky", top: "100px" }}>
          <div
            className="terminal-panel fade-up-3"
            style={{ borderRadius: "16px", padding: "1.25rem" }}
          >
            <div className="label-sm" style={{ marginBottom: "1rem", color: "var(--primary)" }}>
              PTB Preview
            </div>
            <pre
              style={{
                fontSize: "0.72rem",
                fontFamily: "'JetBrains Mono', monospace",
                color: "var(--on-surface-variant)",
                lineHeight: 1.8,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              <span style={{ color: "var(--secondary)" }}>mint_policy</span>
              {"(\n"}
              {"  "}
              <span style={{ color: "var(--primary)" }}>owner</span>
              {"="}{ownerCapId || "?"},
              {"\n  "}
              <span style={{ color: "var(--primary)" }}>max_spend</span>
              {"="}{suiToMist(budget).toString()} MIST,
              {"\n  "}
              <span style={{ color: "var(--primary)" }}>expiry_epoch</span>
              {"="}{expirationEpoch},
              {"\n  "}
              <span style={{ color: "var(--primary)" }}>scopes</span>
              {"=["}{scopes.join(",")}],
              {"\n  "}
              <span style={{ color: "var(--primary)" }}>tee</span>
              {"="}{String(attested)},
              {"\n  "}
              <span style={{ color: "var(--primary)" }}>agent</span>
              {"="}{agentAddr || "?"}
              {"\n)"}
            </pre>
          </div>

          <div
            className="glass-panel edge-light"
            style={{ borderRadius: "16px", padding: "1.25rem" }}
          >
            <div className="label-sm" style={{ marginBottom: "0.75rem" }}>
              Configuration Summary
            </div>
            {[
              { label: "Budget", value: `${budget} SUI`, color: "var(--primary)" },
              { label: "Duration", value: `${expiryDays} day${expiryDays > 1 ? "s" : ""}`, color: "var(--secondary)" },
              { label: "Epoch Expiry", value: `#${expirationEpoch}`, color: "var(--on-surface)" },
              { label: "Scopes", value: `${scopes.length} of 4`, color: "var(--primary)" },
              { label: "TEE Required", value: attested ? "Yes" : "No", color: attested ? "var(--primary)" : "var(--outline)" },
            ].map((row) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.5rem 0",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}
              >
                <span style={{ fontSize: "0.8rem", color: "var(--on-surface-variant)" }}>
                  {row.label}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: "0.8rem", fontWeight: 700, color: row.color }}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
