"use client";
/**
 * app/rooster/page.tsx — Rooster Offers
 *
 * Lists every offer this app has attempted to fund (from the local
 * reconciliation ledger — Rooster has no "list my offers" endpoint) and lets
 * you pull each one's live lifecycle from Rooster on demand via
 * /api/rooster/offers/[offerId]/status.
 */
import { useCallback, useEffect, useState } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────
type FundingState = "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED" | "REFUNDED";

interface ReconciliationRecord {
  idempotencyKey: string;
  agentId: string;
  offerId: string;
  depositAddress?: string;
  amountCents?: number;
  network: string;
  txHash?: string;
  state: FundingState;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

interface LiveOfferStatus {
  offerId: string;
  state: string;
  lifecycle: string;
  terminal: boolean;
  funding?: {
    depositAddress: string;
    amountCents: number;
    currency: string;
    deadline?: string;
  };
  releaseTxHash?: string;
  refundTxHash?: string;
  raw: unknown;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function usd(cents: number | undefined): string {
  if (cents === undefined) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function explorerTxUrl(network: string, hash: string): string | undefined {
  if (network === "base-sepolia") return `https://sepolia.basescan.org/tx/${hash}`;
  if (network === "base") return `https://basescan.org/tx/${hash}`;
  return undefined;
}

function shorten(v: string, lead = 8, tail = 6): string {
  return v.length > lead + tail + 3 ? `${v.slice(0, lead)}…${v.slice(-tail)}` : v;
}

const LEDGER_BADGE: Record<FundingState, string> = {
  PENDING: "badge-amber",
  SUBMITTED: "badge-teal",
  CONFIRMED: "badge-green",
  FAILED: "badge-red",
  REFUNDED: "badge-violet",
};

const LIFECYCLE_BADGE: Record<string, string> = {
  pending_human_decision: "badge-amber",
  countered: "badge-amber",
  rejected: "badge-red",
  expired: "badge-red",
  accepted: "badge-teal",
  provisioning_escrow: "badge-teal",
  awaiting_funding: "badge-amber",
  funded_delivery_in_progress: "badge-teal",
  post_failed_refund_pending: "badge-amber",
  delivered_awaiting_creator_wallet: "badge-teal",
  releasing: "badge-teal",
  completed: "badge-green",
  refunded: "badge-violet",
  refund_failed: "badge-red",
  expired_unfunded: "badge-red",
  escrow_error: "badge-red",
  test_completed_simulated: "badge-green",
};

function lifecycleNote(status: LiveOfferStatus): string | undefined {
  const raw = status.raw as { offer?: Record<string, unknown> } & Record<string, unknown>;
  const data = raw?.offer ?? raw;
  const note = (data as Record<string, unknown> | undefined)?.lifecycle_note;
  return typeof note === "string" ? note : undefined;
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function RoosterOffersPage() {
  const [records, setRecords] = useState<ReconciliationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [live, setLive] = useState<Record<string, LiveOfferStatus>>({});
  const [liveLoading, setLiveLoading] = useState<Record<string, boolean>>({});
  const [liveErr, setLiveErr] = useState<Record<string, string>>({});

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rooster/offers");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load offers");
      setRecords(data.records as ReconciliationRecord[]);
      setLoadErr("");
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshStatus = useCallback(async (offerId: string) => {
    setLiveLoading((p) => ({ ...p, [offerId]: true }));
    setLiveErr((p) => {
      const next = { ...p };
      delete next[offerId];
      return next;
    });
    try {
      const res = await fetch(`/api/rooster/offers/${encodeURIComponent(offerId)}/status`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to fetch live status");
      setLive((p) => ({ ...p, [offerId]: data.status as LiveOfferStatus }));
    } catch (e) {
      setLiveErr((p) => ({ ...p, [offerId]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setLiveLoading((p) => ({ ...p, [offerId]: false }));
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  return (
    <div>
      <div className="fade-up" style={{ marginBottom: "1.75rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="title text-glow">Rooster Offers</h1>
          <p className="subtitle">
            Offers this agent has funded via the Rooster Agents settlement rail. Live lifecycle is pulled on demand.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={loadRecords} disabled={loading} style={{ fontSize: "0.78rem", padding: "0.45rem 1rem" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
            {loading ? "hourglass_top" : "refresh"}
          </span>
          {loading ? "Loading…" : "Reload ledger"}
        </button>
      </div>

      {loadErr && (
        <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "rgba(147,0,10,0.1)", border: "1px solid rgba(255,180,171,0.2)", color: "var(--error)", fontFamily: "monospace", fontSize: "0.82rem", marginBottom: "1rem" }}>
          ✗ {loadErr}
        </div>
      )}

      {!loading && records.length === 0 && !loadErr && (
        <div className="glass-panel edge-light fade-up-2" style={{ borderRadius: "16px", padding: "2rem", textAlign: "center", color: "var(--outline)" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "36px", display: "block", marginBottom: "0.5rem", opacity: 0.3 }}>
            receipt_long
          </span>
          No funded Rooster offers yet. Submit and fund an offer to see it here.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {records.map((r) => {
          const status = live[r.offerId];
          const isLoading = !!liveLoading[r.offerId];
          const err = liveErr[r.offerId];
          const lifecycleBadge = status ? LIFECYCLE_BADGE[status.lifecycle] ?? "badge-cyan" : undefined;
          const note = status ? lifecycleNote(status) : undefined;

          return (
            <div key={r.idempotencyKey} className="glass-panel edge-light fade-up-2" style={{ borderRadius: "16px", padding: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", marginBottom: "1rem" }}>
                <div>
                  <div className="label-sm" style={{ color: "var(--outline)", marginBottom: "0.3rem" }}>Offer ID</div>
                  <div className="mono" style={{ fontSize: "0.85rem" }}>{r.offerId}</div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexShrink: 0 }}>
                  <span className={`badge ${LEDGER_BADGE[r.state]}`}>{r.state}</span>
                  {status && (
                    <span className={`badge ${lifecycleBadge}`}>
                      {status.lifecycle} {status.terminal ? "· terminal" : ""}
                    </span>
                  )}
                  <button
                    className="btn btn-ghost"
                    onClick={() => refreshStatus(r.offerId)}
                    disabled={isLoading}
                    style={{ fontSize: "0.72rem", padding: "0.35rem 0.75rem" }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                      {isLoading ? "hourglass_top" : "sync"}
                    </span>
                    {isLoading ? "Checking…" : status ? "Refresh" : "Check live status"}
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", fontSize: "0.8rem" }}>
                <div>
                  <div className="label-sm" style={{ color: "var(--outline)", marginBottom: "0.2rem" }}>Amount</div>
                  <div className="mono">{usd(r.amountCents)}</div>
                </div>
                <div>
                  <div className="label-sm" style={{ color: "var(--outline)", marginBottom: "0.2rem" }}>Network</div>
                  <div className="mono">{r.network}</div>
                </div>
                <div>
                  <div className="label-sm" style={{ color: "var(--outline)", marginBottom: "0.2rem" }}>Deposit Address</div>
                  <div className="mono" title={r.depositAddress}>{r.depositAddress ? shorten(r.depositAddress) : "—"}</div>
                </div>
                <div>
                  <div className="label-sm" style={{ color: "var(--outline)", marginBottom: "0.2rem" }}>Settlement Tx</div>
                  {r.txHash ? (
                    explorerTxUrl(r.network, r.txHash) ? (
                      <a href={explorerTxUrl(r.network, r.txHash)} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--primary)", textDecoration: "none" }}>
                        {shorten(r.txHash)} ↗
                      </a>
                    ) : (
                      <span className="mono">{shorten(r.txHash)}</span>
                    )
                  ) : (
                    <span className="mono" style={{ color: "var(--outline)" }}>—</span>
                  )}
                </div>
                <div>
                  <div className="label-sm" style={{ color: "var(--outline)", marginBottom: "0.2rem" }}>Updated</div>
                  <div className="mono">{new Date(r.updatedAt).toLocaleString()}</div>
                </div>
              </div>

              {r.error && (
                <div style={{ marginTop: "0.75rem", fontSize: "0.78rem", color: "var(--error)", fontFamily: "monospace" }}>
                  ✗ {r.error}
                </div>
              )}

              {err && (
                <div style={{ marginTop: "0.75rem", fontSize: "0.78rem", color: "var(--error)", fontFamily: "monospace" }}>
                  ✗ Live status check failed: {err}
                </div>
              )}

              {status && (
                <div style={{ marginTop: "1rem", padding: "1rem", borderRadius: "10px", background: "rgba(161,212,148,0.04)", border: "1px solid rgba(161,212,148,0.15)" }}>
                  {note && <div style={{ fontSize: "0.8rem", marginBottom: "0.75rem" }}>{note}</div>}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem", fontSize: "0.78rem" }}>
                    <div>
                      <span style={{ color: "var(--outline)" }}>Legacy state: </span>
                      <span className="mono">{status.state}</span>
                    </div>
                    {status.funding && (
                      <div>
                        <span style={{ color: "var(--outline)" }}>Awaiting funding: </span>
                        <span className="mono">{usd(status.funding.amountCents)} → {shorten(status.funding.depositAddress)}</span>
                      </div>
                    )}
                    {status.releaseTxHash && (
                      <div>
                        <span style={{ color: "var(--outline)" }}>Release tx: </span>
                        {explorerTxUrl(r.network, status.releaseTxHash) ? (
                          <a href={explorerTxUrl(r.network, status.releaseTxHash)} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--primary)", textDecoration: "none" }}>
                            {shorten(status.releaseTxHash)} ↗
                          </a>
                        ) : (
                          <span className="mono">{shorten(status.releaseTxHash)}</span>
                        )}
                      </div>
                    )}
                    {status.refundTxHash && (
                      <div>
                        <span style={{ color: "var(--outline)" }}>Refund tx: </span>
                        {explorerTxUrl(r.network, status.refundTxHash) ? (
                          <a href={explorerTxUrl(r.network, status.refundTxHash)} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--primary)", textDecoration: "none" }}>
                            {shorten(status.refundTxHash)} ↗
                          </a>
                        ) : (
                          <span className="mono">{shorten(status.refundTxHash)}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
