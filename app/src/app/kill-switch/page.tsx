"use client";
/**
 * app/kill-switch/page.tsx — Emergency Revocation — Botanical Glassmorphism Redesign
 */
import { useState, useEffect } from "react";

const CONFIRM_WORD = "REVOKE";

export default function KillSwitchPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [ownerCapId, setOwnerCapId] = useState("");
  const [policyCapId, setPolicyCapId] = useState(
    process.env.NEXT_PUBLIC_POLICY_CAP_ID ?? "",
  );
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<{ txBytes: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [epochInfo, setEpochInfo] = useState<{
    current: number;
    remaining: number;
    endTimestampMs?: number;
  } | null>(null);
  const [timeRemainingStr, setTimeRemainingStr] = useState<string>("calculating...");

  useEffect(() => {
    fetch("/api/policy/status")
      .then((r) => r.json())
      .then((d) => {
        if (d.policy?.id) setPolicyCapId(d.policy.id);
        if (d.currentEpoch) {
          fetch("/api/chain/epoch")
            .then((r) => r.json())
            .then((chainData) => {
              setEpochInfo({
                current: d.currentEpoch,
                remaining: d.epochsRemaining,
                endTimestampMs:
                  chainData.epochStartTimestampMs + chainData.epochDurationMs,
              });
            })
            .catch(() => {
              setEpochInfo({ current: d.currentEpoch, remaining: d.epochsRemaining });
            });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!epochInfo?.endTimestampMs) return;
    const updateTime = () => {
      const diffMs = epochInfo.endTimestampMs! - Date.now();
      if (diffMs <= 0) { setTimeRemainingStr("soon"); return; }
      const hrs = Math.floor(diffMs / 3600000);
      const mins = Math.floor((diffMs % 3600000) / 60000);
      setTimeRemainingStr(`~${hrs}h ${mins}m`);
    };
    updateTime();
    const id = setInterval(updateTime, 60000);
    return () => clearInterval(id);
  }, [epochInfo]);

  const handleRevoke = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/owner/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerCapId, policyCapId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unknown error");
      setResult(data);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto" }}>
      {/* Dramatic header */}
      <div
        className="fade-up"
        style={{ textAlign: "center", marginBottom: "2.5rem" }}
      >
        <div
          style={{
            width: "100px",
            height: "100px",
            borderRadius: "50%",
            background: "rgba(147,0,10,0.15)",
            border: "2px solid rgba(255,180,171,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1.5rem",
            animation: "pulse-anim 3s ease-in-out infinite",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: "48px",
              color: "var(--error)",
              fontVariationSettings: "'FILL' 1",
            }}
          >
            power_settings_new
          </span>
        </div>
        <h1 style={{ color: "var(--error)", fontSize: "1.75rem", marginBottom: "0.5rem" }}>
          Agent Kill Switch
        </h1>
        <p style={{ color: "var(--on-surface-variant)", fontSize: "0.95rem", maxWidth: "460px", margin: "0 auto" }}>
          Permanently revokes the agent's PolicyCap. One transaction. No undo.
          The next agent PTB will abort with{" "}
          <span className="mono" style={{ color: "var(--error)" }}>
            EObjectNotFound
          </span>
          .
        </p>
      </div>

      {/* Epoch countdown */}
      {epochInfo && (
        <div
          className="glass-panel edge-light fade-up-2"
          style={{
            borderRadius: "16px",
            padding: "1.5rem",
            marginBottom: "1rem",
            borderColor: "rgba(255,180,171,0.15)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="label-sm" style={{ color: "var(--on-surface-variant)", marginBottom: "0.25rem" }}>
                Current Exposure Window
              </div>
              <div
                className="mono"
                style={{ fontSize: "1.5rem", fontWeight: 700, color: "#fbbf24" }}
              >
                {timeRemainingStr}
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--on-surface-variant)", marginTop: "0.2rem" }}>
                until PolicyCap auto-expires (epoch{" "}
                {epochInfo.current + epochInfo.remaining})
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="label-sm" style={{ color: "var(--on-surface-variant)", marginBottom: "0.25rem" }}>
                Current Epoch
              </div>
              <div className="mono" style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                {epochInfo.current}
              </div>
            </div>
          </div>
          <div style={{ marginTop: "1rem" }}>
            <div className="progress-track">
              <div
                className="progress-fill red"
                style={{
                  width: `${Math.min(100, Math.round((1 / Math.max(epochInfo.remaining, 1)) * 100))}%`,
                }}
              />
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--outline)", marginTop: "0.4rem" }}>
              Revoking now eliminates all remaining exposure instantly.
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Enter IDs */}
      {step === 1 && (
        <div
          className="glass-panel edge-light fade-up-3"
          style={{
            borderRadius: "16px",
            padding: "1.75rem",
            borderColor: "rgba(255,180,171,0.1)",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                background: "rgba(147,0,10,0.15)",
                border: "1px solid rgba(255,180,171,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.85rem",
                fontWeight: 700,
                color: "var(--error)",
              }}
            >
              1
            </div>
            <h3 style={{ fontSize: "1rem" }}>Verify Ownership</h3>
          </div>

          <div>
            <label className="label">Your OwnerCap Object ID</label>
            <input
              id="ownerCapKill"
              className="input mono"
              placeholder="0x…"
              value={ownerCapId}
              onChange={(e) => setOwnerCapId(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Agent PolicyCap Object ID</label>
            <input
              id="policyCapKill"
              className="input mono"
              placeholder="0x…"
              value={policyCapId}
              onChange={(e) => setPolicyCapId(e.target.value)}
            />
          </div>

          <button
            id="proceedStep2"
            className="btn btn-ghost"
            disabled={!ownerCapId || !policyCapId}
            onClick={() => setStep(2)}
            style={{ alignSelf: "flex-start" }}
          >
            Continue →
          </button>
        </div>
      )}

      {/* Step 2: Confirm */}
      {step === 2 && (
        <div
          className="glass-panel fade-up-3"
          style={{
            borderRadius: "16px",
            padding: "1.75rem",
            border: "1px solid rgba(255,180,171,0.25)",
            display: "flex",
            flexDirection: "column",
            gap: "1.5rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                background: "rgba(147,0,10,0.2)",
                border: "1px solid rgba(255,180,171,0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.85rem",
                fontWeight: 700,
                color: "var(--error)",
              }}
            >
              2
            </div>
            <h3 style={{ fontSize: "1rem" }}>Confirm Revocation</h3>
          </div>

          <div
            style={{
              background: "rgba(147,0,10,0.08)",
              border: "1px solid rgba(255,180,171,0.15)",
              borderRadius: "10px",
              padding: "1rem",
              fontSize: "0.875rem",
              color: "var(--on-surface-variant)",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: "var(--error)" }}>
              ⚠ This action is irreversible.
            </strong>
            <br />
            The Move contract will call{" "}
            <span className="mono">object::delete(id)</span> on the PolicyCap.
            The agent's throwaway keypair will be left with no financial
            authority. You can mint a new PolicyCap at any time, but this one is
            permanently gone.
          </div>

          <div>
            <label className="label">
              Type{" "}
              <span className="mono" style={{ color: "var(--error)" }}>
                {CONFIRM_WORD}
              </span>{" "}
              to confirm
            </label>
            <input
              id="confirmRevoke"
              className="input mono"
              placeholder={CONFIRM_WORD}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
              style={{
                borderColor:
                  confirmText === CONFIRM_WORD
                    ? "var(--error)"
                    : undefined,
              }}
            />
          </div>

          {error && (
            <div
              style={{
                color: "var(--error)",
                fontFamily: "monospace",
                fontSize: "0.83rem",
                padding: "0.75rem",
                borderRadius: "8px",
                background: "rgba(147,0,10,0.1)",
              }}
            >
              ✗ {error}
            </div>
          )}

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button
              id="cancelRevoke"
              className="btn btn-ghost"
              onClick={() => {
                setStep(1);
                setConfirmText("");
              }}
            >
              ← Cancel
            </button>
            <button
              id="executeRevoke"
              className="btn btn-kill"
              disabled={confirmText !== CONFIRM_WORD || loading}
              onClick={handleRevoke}
              style={{ fontSize: "1rem", padding: "0.75rem 2rem" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                {loading ? "hourglass_top" : "power_settings_new"}
              </span>
              {loading ? "Building Transaction…" : "REVOKE AGENT NOW"}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Done */}
      {step === 3 && result && (
        <div
          className="glass-panel fade-up"
          style={{
            borderRadius: "16px",
            padding: "2rem",
            border: "1px solid rgba(255,180,171,0.3)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>💀</div>
          <h2 style={{ color: "var(--error)", marginBottom: "0.5rem" }}>
            PolicyCap Revoked
          </h2>
          <p style={{ color: "var(--on-surface-variant)", fontSize: "0.9rem", marginBottom: "1.5rem", maxWidth: "360px", margin: "0 auto 1.5rem" }}>
            Transaction built. Submit via Sui CLI or wallet adapter. After
            finality the agent's next PTB will fail at the network level.
          </p>

          <div
            style={{
              background: "rgba(0,23,17,0.6)",
              borderRadius: "10px",
              padding: "1rem",
              fontFamily: "monospace",
              fontSize: "0.7rem",
              color: "var(--outline)",
              textAlign: "left",
              wordBreak: "break-all",
              maxHeight: "120px",
              overflow: "auto",
              marginBottom: "1.5rem",
            }}
          >
            sui client execute-signed-tx --tx-bytes{" "}
            {result.txBytes.slice(0, 100)}…
          </div>

          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
            <a href="/" className="btn btn-ghost">
              ← Mission Control
            </a>
            <a href="/provision" className="btn btn-primary">
              + New PolicyCap
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
