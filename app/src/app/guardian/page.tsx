"use client";
/**
 * app/guardian/page.tsx — Guardian Alert Feed
 *
 * Displays all BLOCK and WARN risk events in real time.
 * Reads from the audit SSE stream + allows manual Guardian analysis.
 * Severity badges: BLOCK (red), MEDIUM (amber), LOW (green).
 */
import { useState, useEffect } from "react";

interface GuardianResult {
  id: string;
  ts: number;
  ok: boolean;
  risk_level: "BLOCK" | "HIGH" | "MEDIUM" | "LOW";
  risk_score: number;
  blocks: string[];
  warnings: string[];
  human_summary: string;
  requires_confirmation: boolean;
  confirmation_token: string | null;
  details: Record<string, unknown>;
  policy_snapshot?: {
    max_spend_sui: string;
    current_spend_sui: string;
    remaining_sui: string;
    expiration_epoch: number;
    current_epoch: number;
    allowed_scopes: number[];
  };
}

const SCOPE_OPTIONS = [
  { tag: 1, label: "402 Data" },
  { tag: 2, label: "DeepBook Spot" },
  { tag: 3, label: "DeepBook Margin" },
  { tag: 4, label: "DeepBook Predict" },
];

// ─── Override Button ─────────────────────────────────────────────────────────
function OverrideButton({
  confirmationToken,
  alertId,
  onOverridden,
}: {
  confirmationToken: string;
  alertId: string;
  onOverridden: (token: string, note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!note.trim()) { setErr("Audit note is required."); return; }
    setSubmitting(true);
    setErr("");
    try {
      const res = await fetch("/api/guardian/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation_token: confirmationToken, audit_note: note }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr(data.error ?? "Override failed.");
        return;
      }
      onOverridden(confirmationToken, note);
      setOpen(false);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <div style={{ marginTop: "0.75rem" }}>
        <button
          id={`overrideBtn-${alertId}`}
          className="btn btn-ghost"
          style={{ fontSize: "0.8rem" }}
          onClick={() => setOpen(true)}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>
            history_edu
          </span>
          Override with audit note
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "0.75rem", padding: "0.9rem", borderRadius: "8px", background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.15)" }}>
      <div className="label" style={{ marginBottom: "0.4rem" }}>
        Audit Note — this override is recorded (token: {confirmationToken.slice(0, 8)}…)
      </div>
      <textarea
        id={`overrideNote-${alertId}`}
        className="input"
        placeholder="Reason for override (e.g. 'Low volatility period, accept HIGH slippage risk')…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{ resize: "vertical", minHeight: "48px", marginBottom: "0.6rem", fontFamily: "inherit" }}
      />
      {err && <div style={{ color: "var(--error)", fontSize: "0.78rem", marginBottom: "0.4rem" }}>✗ {err}</div>}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          id={`overrideSubmit-${alertId}`}
          className="btn btn-primary"
          style={{ fontSize: "0.8rem" }}
          onClick={submit}
          disabled={submitting}
        >
          {submitting ? "Submitting…" : "Submit Override"}
        </button>
        <button className="btn btn-ghost" style={{ fontSize: "0.8rem" }} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}


export default function GuardianPage() {
  const [alerts, setAlerts] = useState<GuardianResult[]>([]);
  const [running, setRunning] = useState(false);
  const [form, setForm] = useState({
    action: "BUY" as "BUY" | "SELL",
    amountSui: "0.05",
    scopeTag: 1,
  });

  const runGuardian = async () => {
    setRunning(true);
    try {
      const amountMist = Math.round(parseFloat(form.amountSui) * 1e9);
      const res = await fetch("/api/guardian/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: form.action,
          amountMist,
          scopeTag: form.scopeTag,
          intentKey: `${form.action}:${form.scopeTag}:${amountMist}:${Date.now()}`,
        }),
      });
      const data = await res.json();
      const result: GuardianResult = {
        id: crypto.randomUUID(),
        ts: Date.now(),
        ...data,
      };
      setAlerts((prev) => [result, ...prev].slice(0, 50));
    } catch (e) {
      setAlerts((prev) => [
        {
          id: crypto.randomUUID(),
          ts: Date.now(),
          ok: false,
          risk_level: "BLOCK",
          risk_score: 100,
          blocks: ["NETWORK_ERROR"],
          warnings: [],
          human_summary: `Network error: ${String(e)}`,
          requires_confirmation: false,
          confirmation_token: null,
          details: {},
        },
        ...prev,
      ]);
    } finally {
      setRunning(false);
    }
  };

  const levelColor = (level: string) => {
    if (level === "BLOCK" || level === "HIGH") return "var(--accent-kill)";
    if (level === "MEDIUM") return "var(--accent-amber)";
    return "var(--accent-emerald)";
  };
  const levelBadge = (level: string) => {
    if (level === "BLOCK" || level === "HIGH") return "badge-red";
    if (level === "MEDIUM") return "badge-amber";
    return "badge-emerald";
  };

  return (
    <div className="container">
      <div className="fade-up" style={{ marginBottom: "2rem" }}>
        <h1>Guardian Alert Feed</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem", fontSize: "0.9rem" }}>
          Pre-flight risk engine — 6 risk classes checked before any PTB is signed.
          Real Pyth oracle data · live PolicyCap state · duplicate-intent detection.
        </p>
      </div>

      {/* Manual trigger */}
      <div className="card glow-cyan fade-up-2" style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ marginBottom: "1rem" }}>Run Pre-flight Check</h3>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label className="label">Action</label>
            <select
              id="guardianAction"
              className="input"
              value={form.action}
              onChange={(e) => setForm((f) => ({ ...f, action: e.target.value as "BUY" | "SELL" }))}
              style={{ background: "var(--bg-deep)", color: "var(--text-primary)" }}
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </div>
          <div>
            <label className="label">Amount (SUI)</label>
            <input
              id="guardianAmount"
              className="input mono"
              type="number"
              step="0.01"
              min="0.001"
              value={form.amountSui}
              onChange={(e) => setForm((f) => ({ ...f, amountSui: e.target.value }))}
              style={{ width: "130px" }}
            />
          </div>
          <div>
            <label className="label">Scope</label>
            <select
              id="guardianScope"
              className="input"
              value={form.scopeTag}
              onChange={(e) => setForm((f) => ({ ...f, scopeTag: Number(e.target.value) }))}
              style={{ background: "var(--bg-deep)", color: "var(--text-primary)" }}
            >
              {SCOPE_OPTIONS.map((s) => (
                <option key={s.tag} value={s.tag}>{s.label}</option>
              ))}
            </select>
          </div>
          <button
            id="runGuardianBtn"
            className="btn btn-primary"
            onClick={runGuardian}
            disabled={running}
          >
            {running ? "Analyzing…" : "▶ Analyze"}
          </button>
        </div>
      </div>

      {/* Alert list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {alerts.length === 0 ? (
          <div className="card" style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
            No alerts yet. Run a pre-flight check above to see real-time Guardian analysis.
          </div>
        ) : (
          alerts.map((alert) => (
            <div
              key={alert.id}
              className="card fade-up"
              style={{
                borderColor: `rgba(${alert.risk_level === "BLOCK" || alert.risk_level === "HIGH" ? "239,68,68" : alert.risk_level === "MEDIUM" ? "245,158,11" : "52,211,153"},0.25)`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <span className={`badge ${levelBadge(alert.risk_level)}`}>
                    {alert.risk_level}
                  </span>
                  <span className="mono" style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                    score: {alert.risk_score}/100
                  </span>
                </div>
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
                  {new Date(alert.ts).toLocaleTimeString()}
                </span>
              </div>

              <p style={{ fontSize: "0.875rem", color: "var(--text-primary)", marginBottom: "0.75rem" }}>
                {alert.human_summary}
              </p>

              {(alert.blocks.length > 0 || alert.warnings.length > 0) && (
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                  {alert.blocks.map((b) => (
                    <span key={b} className="badge badge-red">{b}</span>
                  ))}
                  {alert.warnings.map((w) => (
                    <span key={w} className="badge badge-amber">{w}</span>
                  ))}
                </div>
              )}

              {/* Real Pyth oracle details */}
              {(alert.details.pyth_sui_usd || alert.details.estimated_slippage_bps !== undefined) && (
                <div style={{
                  background: "var(--bg-deep)", borderRadius: "8px", padding: "0.6rem 0.9rem",
                  fontFamily: "monospace", fontSize: "0.73rem", color: "var(--text-secondary)",
                  marginBottom: "0.75rem",
                }}>
                  {!!alert.details.pyth_sui_usd && (
                    <div>SUI/USD: ${String(alert.details.pyth_sui_usd as string)} ±${String(alert.details.pyth_conf_usd as string)} · age: {String(alert.details.pyth_age_seconds as number)}s · source: Pyth Hermes v2</div>
                  )}
                  {alert.details.estimated_slippage_bps !== undefined && (
                    <div>Estimated slippage: {String(alert.details.estimated_slippage_bps as number)} bps</div>
                  )}
                </div>
              )}

              {/* Policy snapshot */}
              {alert.policy_snapshot && (
                <div style={{
                  background: "var(--bg-deep)", borderRadius: "8px", padding: "0.6rem 0.9rem",
                  fontFamily: "monospace", fontSize: "0.73rem", color: "var(--text-muted)",
                }}>
                  Policy: {alert.policy_snapshot.current_spend_sui} / {alert.policy_snapshot.max_spend_sui} SUI used ·
                  {alert.policy_snapshot.remaining_sui} SUI remaining ·
                  epoch {alert.policy_snapshot.current_epoch} / {alert.policy_snapshot.expiration_epoch}
                </div>
              )}

              {alert.requires_confirmation && !alert.blocks.length && (
                <OverrideButton
                  confirmationToken={alert.confirmation_token ?? ""}
                  alertId={alert.id}
                  onOverridden={(token, note) =>
                    setAlerts((prev) =>
                      prev.map((a) =>
                        a.id === alert.id
                          ? { ...a, human_summary: `[HUMAN OVERRIDE] ${note} — token: ${token.slice(0, 8)}…` }
                          : a
                      )
                    )
                  }
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
