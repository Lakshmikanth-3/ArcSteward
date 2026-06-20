"use client";
/**
 * app/trading/page.tsx — Trading Desk — Botanical Glassmorphism Redesign
 */
import { useEffect, useState } from "react";
import { mistToSui, SCOPE_LABEL, ACTION_LABEL } from "@/lib/velo-constants";

interface TradeEvent {
  id: string;
  txDigest: string;
  action: string;
  amountMist: bigint;
  scopeTag: number;
  ts: number;
}

const DEEPBOOK_PRODUCTS = [
  {
    tag: 2,
    name: "Spot",
    desc: "Standard limit orders on SUI/USDC pool",
    color: "#818cf8",
    icon: "show_chart",
  },
  {
    tag: 3,
    name: "Margin",
    desc: "Leveraged positions via DeepBook Margin primitive",
    color: "#a78bfa",
    icon: "trending_up",
  },
  {
    tag: 4,
    name: "Predict",
    desc: "Binary / range market positions (DeepBook Predict)",
    color: "#fb923c",
    icon: "psychology",
  },
];

export default function TradingPage() {
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [totalSpot, setTotalSpot] = useState<bigint>(BigInt(0));
  const [totalMargin, setTotalMargin] = useState<bigint>(BigInt(0));
  const [totalPredict, setTotalPredict] = useState<bigint>(BigInt(0));

  useEffect(() => {
    const es = new EventSource("/api/audit/stream");
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type !== "event" || !data.eventType?.includes("AgentActionEvent"))
        return;
      const pj = data.parsedJson as any;
      const scope = Number(pj?.scope_tag ?? 0);
      if (![2, 3, 4].includes(scope)) return;
      const amt = BigInt(pj?.amount ?? 0);
      setTrades((prev) => {
        if (prev.find((t) => t.txDigest === data.txDigest)) return prev;
        return [
          {
            id: data.txDigest,
            txDigest: data.txDigest,
            action: pj?.action_type ?? "",
            amountMist: amt,
            scopeTag: scope,
            ts: Number(data.timestampMs ?? Date.now()),
          },
          ...prev,
        ].slice(0, 100);
      });
      if (scope === 2) setTotalSpot((p) => p + amt);
      if (scope === 3) setTotalMargin((p) => p + amt);
      if (scope === 4) setTotalPredict((p) => p + amt);
    };
    return () => es.close();
  }, []);

  const scopeColor = (s: number) =>
    s === 2 ? "#818cf8" : s === 3 ? "#a78bfa" : "#fb923c";
  const scopeBadgeStyle = (s: number): React.CSSProperties => ({
    background: s === 2 ? "rgba(129,140,248,0.12)" : s === 3 ? "rgba(167,139,250,0.12)" : "rgba(251,146,60,0.12)",
    color: scopeColor(s),
    border: `1px solid ${s === 2 ? "rgba(129,140,248,0.25)" : s === 3 ? "rgba(167,139,250,0.25)" : "rgba(251,146,60,0.25)"}`,
  });

  return (
    <div>
      {/* Page header */}
      <div className="fade-up" style={{ marginBottom: "1.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
          <span className="label-sm" style={{ color: "var(--secondary)", letterSpacing: "0.1em" }}>
            DeepBook V3 Orders
          </span>
        </div>
        <h1 style={{ fontSize: "clamp(1.4rem, 3vw, 2rem)", fontWeight: 700 }}>
          Trading Desk
        </h1>
        <p style={{ color: "var(--on-surface-variant)", marginTop: "0.5rem", maxWidth: "560px" }}>
          Read-only view of all DeepBook orders placed by the agent. The agent's
          PolicyCap enforces budget and scope — every entry here is on-chain.
        </p>
      </div>

      {/* Volume stats */}
      <div className="stat-grid fade-up-2" style={{ marginBottom: "1rem" }}>
        {[
          { label: "Spot Volume", value: mistToSui(totalSpot), color: "#818cf8", sub: "DeepBook Spot", icon: "show_chart" },
          { label: "Margin Volume", value: mistToSui(totalMargin), color: "#a78bfa", sub: "DeepBook Margin", icon: "trending_up" },
          { label: "Predict Volume", value: mistToSui(totalPredict), color: "#fb923c", sub: "DeepBook Predict", icon: "psychology" },
          { label: "Total Trades", value: String(trades.length), color: "var(--primary)", sub: "All scopes", icon: "monitoring" },
        ].map(({ label, value, color, sub, icon }) => (
          <div key={label} className="stat-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
              <div className="stat-label">{label}</div>
              <span className="material-symbols-outlined" style={{ fontSize: "18px", color, opacity: 0.7 }}>
                {icon}
              </span>
            </div>
            <div className="stat-value mono" style={{ color }}>
              {value}
              {label !== "Total Trades" ? " SUI" : ""}
            </div>
            <div className="stat-sub">{sub}</div>
          </div>
        ))}
      </div>

      {/* DeepBook product info */}
      <div
        className="glass-panel edge-light fade-up-2"
        style={{ borderRadius: "16px", padding: "1.5rem", marginBottom: "1rem" }}
      >
        <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>DeepBook V3 Integration</h3>
        <p style={{ color: "var(--on-surface-variant)", fontSize: "0.875rem", marginBottom: "1.25rem" }}>
          The agent constructs PTBs using{" "}
          <span className="mono" style={{ color: "var(--primary)" }}>@mysten/deepbook-v3</span>{" "}
          SDK. Every trade is gated by the PolicyCap scope check on-chain before
          funds leave the Treasury.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: "0.75rem" }}>
          {DEEPBOOK_PRODUCTS.map(({ tag, name, desc, color, icon }) => (
            <div
              key={tag}
              style={{
                background: "rgba(0,23,17,0.5)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "10px",
                padding: "1rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                <span className="material-symbols-outlined" style={{ fontSize: "18px", color }}>
                  {icon}
                </span>
                <div className="mono" style={{ color, fontWeight: 700, fontSize: "0.9rem" }}>
                  {name}
                </div>
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--on-surface-variant)" }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Live Order Log */}
      <div
        className="terminal-panel fade-up-3"
        style={{ borderRadius: "16px" }}
      >
        {/* Terminal header */}
        <div
          style={{
            padding: "0.75rem 1rem",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div style={{ display: "flex", gap: "5px" }}>
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "rgba(255,100,100,0.2)", border: "1px solid rgba(255,100,100,0.4)" }} />
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "rgba(255,200,100,0.2)", border: "1px solid rgba(255,200,100,0.4)" }} />
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "rgba(100,255,150,0.2)", border: "1px solid rgba(100,255,150,0.4)" }} />
            </div>
            <span className="mono" style={{ fontSize: "0.65rem", color: "var(--on-surface-variant)", letterSpacing: "-0.02em", textTransform: "uppercase", marginLeft: "0.5rem" }}>
              Live Order Log — from AgentActionEvent
            </span>
          </div>
          <span className="mono" style={{ fontSize: "0.65rem", color: "var(--primary)" }}>
            {trades.length} orders
          </span>
        </div>

        {/* Terminal body */}
        {trades.length === 0 ? (
          <div
            className="terminal"
            style={{ textAlign: "center", color: "var(--outline)", padding: "3rem 2rem", border: "none", background: "transparent", maxHeight: "none" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "40px", display: "block", marginBottom: "0.75rem", opacity: 0.3 }}>
              monitoring
            </span>
            Waiting for agent to place orders…
            <br />
            <span style={{ fontSize: "0.72rem" }}>
              Agent emits AgentActionEvent on every DeepBook trade.
            </span>
          </div>
        ) : (
          <div className="terminal" style={{ border: "none", background: "transparent", maxHeight: "520px", borderRadius: 0, borderBottomLeftRadius: "16px", borderBottomRightRadius: "16px" }}>
            {trades.map((t) => (
              <div key={t.id} className="term-line">
                <span className="term-ts">{new Date(t.ts).toISOString().substr(11, 8)}</span>
                <span
                  className="badge"
                  style={{
                    ...scopeBadgeStyle(t.scopeTag),
                    fontSize: "0.65rem",
                    padding: "1px 6px",
                  }}
                >
                  {SCOPE_LABEL[t.scopeTag] ?? `Scope ${t.scopeTag}`}
                </span>
                <span className="term-msg">
                  {ACTION_LABEL[t.action] ?? t.action} ·{" "}
                  {mistToSui(t.amountMist)} SUI{" "}
                  <a
                    href={`https://testnet.suivision.xyz/txblock/${t.txDigest}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--outline)", fontSize: "0.7rem" }}
                  >
                    {t.txDigest.slice(0, 10)}…
                  </a>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
