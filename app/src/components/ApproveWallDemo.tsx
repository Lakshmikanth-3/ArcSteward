import { useState, useEffect } from 'react';

export default function ApproveWallDemo() {
  const [legacyStuck, setLegacyStuck] = useState(false);
  const [agentStep, setAgentStep] = useState(0);
  const steps = [
    "Agent hits sentiment API...",
    "402 received → auto-paying 0.05 SUI...",
    "Payment confirmed on-chain ✓",
    "Seal dataset unlocked ✓",
    "DeepBook Predict position minted ✓",
  ];

  useEffect(() => {
    // Legacy side freezes at step 1
    const t1 = setTimeout(() => setLegacyStuck(true), 1200);
    // Agent side auto-progresses
    const timeouts = steps.map((_, i) => {
      return setTimeout(() => setAgentStep(i + 1), 1500 + i * 2000);
    });
    
    return () => {
      clearTimeout(t1);
      timeouts.forEach(clearTimeout);
    };
  }, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", margin: "2rem 0", fontFamily: "monospace", fontSize: "0.85rem", width: "100%" }}>
      {/* LEFT — Legacy */}
      <div className="glass-panel edge-light" style={{ padding: "1.5rem", borderRadius: "16px", background: "rgba(20,20,20,0.6)" }}>
        <p style={{ color: "var(--on-surface-variant)", marginBottom: "1rem", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>Legacy agent</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <p style={{ color: "var(--on-surface)" }}>Querying market data...</p>
          {legacyStuck && (
            <div style={{ border: "1px solid rgba(251, 146, 60, 0.3)", borderRadius: "8px", padding: "1rem", background: "rgba(251, 146, 60, 0.05)", marginTop: "0.5rem" }}>
              <p style={{ color: "#fb923c", fontSize: "0.75rem", fontWeight: "bold" }}>🦊 MetaMask Popup</p>
              <p style={{ color: "var(--on-surface-variant)", fontSize: "0.75rem", marginTop: "0.25rem" }}>Waiting for human to click Sign...</p>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                <button style={{ fontSize: "0.75rem", background: "rgba(255,255,255,0.1)", color: "var(--on-surface)", padding: "4px 8px", border: "none", borderRadius: "4px", opacity: 0.6 }}>Cancel</button>
                <button style={{ fontSize: "0.75rem", background: "#ea580c", color: "#fff", padding: "4px 8px", border: "none", borderRadius: "4px" }} className="pulse">Sign →</button>
              </div>
            </div>
          )}
          {legacyStuck && <p style={{ color: "var(--error)", fontSize: "0.75rem", marginTop: "0.5rem" }} className="pulse">⏸ Agent stalled. Waiting for human...</p>}
        </div>
      </div>

      {/* RIGHT — Velo402 */}
      <div className="glass-panel edge-light" style={{ padding: "1.5rem", borderRadius: "16px", background: "rgba(20,20,20,0.6)" }}>
        <p style={{ color: "var(--on-surface-variant)", marginBottom: "1rem", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>Velo402 agent</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {steps.slice(0, agentStep).map((step, i) => (
            <p key={i} style={{ color: "var(--primary)", fontSize: "0.75rem" }}>✓ {step}</p>
          ))}
          {agentStep >= steps.length && (
            <p style={{ color: "#38bdf8", fontSize: "0.75rem", fontWeight: "bold", marginTop: "0.5rem" }}>🏁 Done. No human required.</p>
          )}
        </div>
      </div>
    </div>
  );
}
