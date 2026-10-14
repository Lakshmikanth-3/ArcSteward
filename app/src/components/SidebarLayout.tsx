"use client";
/**
 * SidebarLayout.tsx
 * Fixed left sidebar + top header shell for all inner app pages.
 * Routes: /dashboard, /provision, /marketplace, /trading, /guardian, /kill-switch
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import GlobalStatsTicker from "./GlobalStatsTicker";
import { network } from "@/lib/arc/config";
import ArcWorkspace from "./ArcWorkspace";

const ARC_NAV = [
  { href: "/arc", icon: "account_balance_wallet", label: "Arc Vault" },
  { href: "/arc#arc-vault", icon: "savings", label: "Create & Fund" },
  { href: "/arc#arc-revoke", icon: "verified_user", label: "Agent Capabilities" },
  { href: "/arc#arc-payments", icon: "payments", label: "USDC Payments" },
  { href: "/arc#arc-history", icon: "receipt_long", label: "Event History" },
  { href: "/infrastructure", icon: "hub", label: "Arc Infrastructure" },
  { href: "/submission", icon: "fact_check", label: "Grant Readiness" },
  { href: "/testnet", icon: "science", label: "Arc Testnet" },
];

const NAV = [
  { href: "/arc", icon: "account_balance_wallet", label: "Arc Vault" },
  { href: "/dashboard",   icon: "dashboard",          label: "Mission Control" },
  { href: "/provision",   icon: "tune",               label: "Provision" },
  { href: "/marketplace", icon: "storefront",          label: "Knowledge" },
  { href: "/trading",     icon: "candlestick_chart",   label: "Trading Desk" },
  { href: "/guardian",    icon: "shield_with_heart",   label: "Guardian" },
  { href: "/rooster",     icon: "receipt_long",        label: "Rooster Offers" },
];

export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isArc = pathname === "/arc" || pathname === "/testnet" || pathname === "/infrastructure" || pathname === "/submission";
  const chain = network(pathname === "/testnet" ? "testnet" : process.env.NEXT_PUBLIC_ARC_NETWORK ?? "mainnet");
  const arcNav = pathname === "/testnet" ? ARC_NAV.map(item => ({ ...item, href: item.href.startsWith('/arc#') ? item.href.replace('/arc#', '/testnet#') : item.href })) : ARC_NAV;

  if (isArc) return <ArcWorkspace>{children}</ArcWorkspace>;

  return (
    <>
      {/* ── Sidebar ── */}
      <nav className="sidebar">
        <Link href={isArc ? "/" : "/dashboard"} className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "22px", fontVariationSettings: "'FILL' 1" }}
            >
              speed
            </span>
          </div>
          <span style={{ fontWeight: 700, fontSize: "1.05rem", letterSpacing: "-0.01em" }}>
            Velo402
          </span>
        </Link>

        <div className="sidebar-nav">
          {(isArc ? arcNav : NAV).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-link${pathname === item.href || pathname.startsWith(item.href + "/") ? " active" : ""}`}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: "20px",
                  fontVariationSettings:
                    pathname === item.href ? "'FILL' 1" : "'FILL' 0",
                }}
              >
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </div>

        {/* Kill switch at bottom */}
        {!isArc && <Link href="/kill-switch" className="sidebar-link kill-link">
          <span
            className="material-symbols-outlined"
            style={{ fontSize: "20px", fontVariationSettings: "'FILL' 1" }}
          >
            power_settings_new
          </span>
          Kill Switch
        </Link>}
      </nav>

      {/* ── Top header ── */}
      <header className="top-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--on-surface-variant)" }}>
            {isArc ? `${chain.name} · ${chain.id}` : "Legacy Sui Testnet"}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span className="pulse-dot live" />
            <span style={{ fontSize: "0.75rem", color: "var(--secondary)" }}>{isArc ? pathname === "/testnet" ? "Testnet demo · inspect receipts" : "Mainnet unverified" : "Legacy integration"}</span>
          </div>
        </div>

        {/* Injected Global Stats Ticker in the center */}
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          {!isArc && <GlobalStatsTicker />}
        </div>

        <Link
          href={isArc ? `${pathname === "/testnet" ? "/testnet" : "/arc"}#arc-revoke` : "/kill-switch"}
          className="btn btn-kill"
          style={{ fontSize: "0.78rem", padding: "0.45rem 1rem" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
            power_settings_new
          </span>
          {isArc ? "Arc Revoke" : "Kill Switch"}
        </Link>
      </header>

      {/* ── Page content ── */}
      <main className="app-main">
        <div className="page-content">{children}</div>
      </main>
    </>
  );
}
