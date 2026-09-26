"use client";
import { useState, useEffect, useRef } from "react";
import { DashboardTab } from "./dashboard/DashboardTab";
import { TransactionsTab } from "./transactions/TransactionsTab";
import { AdminTab } from "./admin/AdminTab";
import { DocsTab } from "./docs/DocsTab";
import { TabErrorBoundary } from "@/components/ui/TabErrorBoundary";
import { GuidedTour, useGuidedTour } from "@/components/onboarding/GuidedTour";
import { AMBER, BG1, BORDER, DIM, MONO, STATUS_META } from "@/lib/constants";
import { useSorobanStatus } from "@/lib/soroban/useSorobanStatus";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useToast } from "@/components/ui/Toast";
import { shortId } from "@/lib/utils";

type Tab = "dashboard" | "transactions" | "admin" | "docs";
const TABS: Tab[] = ["dashboard", "transactions", "admin", "docs"];

export function Shell() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const { status: rpcStatus, lastEventAge, health: rpcHealth } = useSorobanStatus();
  const { address, connecting, error, connect, disconnect } = useWallet();
  const connected = address !== null;
  const { toast } = useToast();
  const tour = useGuidedTour();

  useEffect(() => {
    if (error) toast(error, "error");
  }, [error, toast]);

  const prevAddress = useRef<string | null>(null);
  useEffect(() => {
    if (address && !prevAddress.current) {
      toast(`Wallet connected: ${shortId(address)}`, "success");
    }
    prevAddress.current = address;
  }, [address, toast]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* ── Header ── */}
      <header className="shell-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.14em", color: "#fff" }}>
            SYNAPSE
          </span>
          <span
            aria-hidden="true"
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: AMBER,
              display: "inline-block",
              boxShadow: `0 0 8px 2px rgba(245,166,35,0.55)`,
            }}
          />
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.14em", color: "#fff" }}>
            CORE
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button
            onClick={tour.start}
            aria-label="Start guided tour"
            style={{
              background: "none",
              border: "none",
              color: DIM,
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "0.1em",
              cursor: "pointer",
              padding: 0,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = AMBER)}
            onMouseLeave={(e) => (e.currentTarget.style.color = DIM)}
          >
            ? tour
          </button>
          <span
            style={{
              fontSize: 9,
              color: DIM,
              letterSpacing: "0.14em",
              padding: "3px 10px",
              border: `1px solid ${BORDER}`,
            }}
          >
            TESTNET
          </span>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: connected ? STATUS_META.COMPLETED.color : "#444",
              display: "inline-block",
              boxShadow: connected ? `0 0 6px 2px ${STATUS_META.COMPLETED.glow}` : "none",
              transition: "all 0.3s",
            }}
          />
          <button
            data-tour="wallet"
            onClick={() => (connected ? disconnect() : connect())}
            disabled={connecting}
            style={{
              padding: "7px 18px",
              background: connected ? "transparent" : "rgba(245,166,35,0.08)",
              border: `1px solid ${connected ? BORDER : AMBER}`,
              color: connected ? "#aaa" : AMBER,
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              cursor: connecting ? "wait" : "pointer",
              letterSpacing: "0.06em",
              transition: "all 0.2s",
              opacity: connecting ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!connected) e.currentTarget.style.background = "rgba(245,166,35,0.16)";
            }}
            onMouseLeave={(e) => {
              if (!connected) e.currentTarget.style.background = "rgba(245,166,35,0.08)";
            }}
          >
            {connecting ? "connecting…" : connected ? shortId(address) : "connect wallet"}
          </button>
        </div>
      </header>

      {/* ── Tab Bar ── */}
      <nav className="shell-nav" role="tablist" aria-label="Sections" data-tour="nav">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            data-tour={t}
            onClick={() => setTab(t)}
            style={{
              padding: "12px 22px",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: "0.1em",
              color: tab === t ? "#fff" : DIM,
              borderBottom: tab === t ? `2px solid ${AMBER}` : "2px solid transparent",
              marginBottom: -1,
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => {
              if (tab !== t) e.currentTarget.style.color = "rgba(255,255,255,0.65)";
            }}
            onMouseLeave={(e) => {
              if (tab !== t) e.currentTarget.style.color = DIM;
            }}
          >
            {t}
          </button>
        ))}
      </nav>

      {/* ── Body ── */}
      <main className="shell-main">
        {tab === "dashboard" && (
          <TabErrorBoundary title="Dashboard tab error">
            <DashboardTab />
          </TabErrorBoundary>
        )}
        {tab === "transactions" && (
          <TabErrorBoundary title="Transactions tab error">
            <TransactionsTab />
          </TabErrorBoundary>
        )}
        {tab === "admin" && (
          <TabErrorBoundary title="Admin tab error">
            <AdminTab />
          </TabErrorBoundary>
        )}
        {tab === "docs" && (
          <TabErrorBoundary title="Docs tab error">
            <DocsTab />
          </TabErrorBoundary>
        )}
      </main>

      {/* ── Footer ── */}
      <footer
        style={{
          borderTop: `1px solid ${BORDER}`,
          padding: "10px 28px",
          display: "flex",
          justifyContent: "space-between",
          background: BG1,
        }}
      >
        <span style={{ fontSize: 9, color: DIM, letterSpacing: "0.1em" }}>
          SYNAPSE CORE · v0.1.0 · TESTNET
        </span>
        <span
          style={{
            fontSize: 9,
            letterSpacing: "0.1em",
            color:
              rpcStatus === "connected"
                ? STATUS_META.COMPLETED.color
                : rpcStatus === "error"
                  ? STATUS_META.FAILED.color
                  : DIM,
          }}
        >
          ⬡ SOROBAN RPC:{" "}
          {rpcStatus === "connected"
            ? `connected${lastEventAge ? ` · last event ${lastEventAge}` : ""}`
            : rpcStatus === "error"
              ? `error${rpcHealth.error ? `: ${rpcHealth.error}` : ""}`
              : "connecting"}
        </span>
      </footer>

      {/* ── Guided Tour ── */}
      <GuidedTour open={tour.open} onClose={tour.close} />
    </div>
  );
}
