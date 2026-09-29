"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { DashboardTab } from "./dashboard/DashboardTab";
import { TransactionsTab } from "./transactions/TransactionsTab";
import { AdminTab } from "./admin/AdminTab";
import { DocsTab } from "./docs/DocsTab";
import { AnalyticsTab } from "./analytics/AnalyticsTab";
import { NotificationCenter } from "./notifications/NotificationCenter";
import { NotificationProvider } from "@/lib/notifications/NotificationStore";
import { TabErrorBoundary } from "@/components/ui/TabErrorBoundary";
import { GuidedTour, useGuidedTour } from "@/components/onboarding/GuidedTour";
import { CommandPalette, type Command } from "./command-palette/CommandPalette";
import { SessionAuditPanel } from "@/components/wallet/SessionAuditPanel";
import { ContractSwitcher } from "@/components/ui/ContractSwitcher";
import { AMBER, BG1, BORDER, DIM, MONO, STATUS_META } from "@/lib/constants";
import { useSorobanStatus } from "@/lib/soroban/useSorobanStatus";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useToast } from "@/components/ui/Toast";
import { shortId } from "@/lib/utils";
import { useWalletExtensionDetection } from "@/lib/wallet/detection";
import { NoWalletGuidance } from "@/components/wallet/NoWalletGuidance";
import { Profiled, ProfilerOverlay } from "@/lib/dev-tools/ProfilerOverlay";

const TabLoadingFallback = () => (
  <div
    role="status"
    aria-live="polite"
    style={{
      padding: "40px 20px",
      textAlign: "center",
      fontFamily: MONO,
      fontSize: 11,
      color: DIM,
      letterSpacing: "0.1em",
    }}
  >
    LOADING TAB MODULE…
  </div>
);

import { Profiled, ProfilerOverlay } from "@/lib/dev-tools/ProfilerOverlay";

// Code-split each tab into lazy-loaded chunks via next/dynamic
const DashboardTab = dynamic(
  () => import("./dashboard/DashboardTab").then((mod) => mod.DashboardTab),
  { loading: () => <TabLoadingFallback /> }
);

const TransactionsTab = dynamic(
  () => import("./transactions/TransactionsTab").then((mod) => mod.TransactionsTab),
  { loading: () => <TabLoadingFallback /> }
);

const AdminTab = dynamic(() => import("./admin/AdminTab").then((mod) => mod.AdminTab), {
  loading: () => <TabLoadingFallback />,
});

const DocsTab = dynamic(() => import("./docs/DocsTab").then((mod) => mod.DocsTab), {
  loading: () => <TabLoadingFallback />,
});

export type Tab = "dashboard" | "transactions" | "analytics" | "admin" | "docs";
export const TABS: Tab[] = ["dashboard", "transactions", "analytics", "admin", "docs"];

type Theme = "dark" | "light";
const THEME_STORAGE_KEY = "synapse-theme";

function getPreferredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as string[]).includes(value);
}

export function Shell({ initialTab = "dashboard" }: { initialTab?: Tab }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = isTab(tabParam) ? tabParam : initialTab;

  const setTab = useCallback(
    (next: Tab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "dashboard") {
        params.delete("tab");
      } else {
        params.set("tab", next);
      }
      const qs = params.toString();
      router.push(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, searchParams],
  );

  const [theme, setTheme] = useState<Theme>("dark");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [showGuidance, setShowGuidance] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { status: rpcStatus, lastEventAge, health: rpcHealth } = useSorobanStatus();
  const { address, accounts, connecting, error, connect, disconnect, switchAccount } = useWallet();
  const { hasAny, checked } = useWalletExtensionDetection();
  const connected = address !== null;
  const canSwitch = connected && accounts.length > 1;
  const { toast } = useToast();
  const tour = useGuidedTour();
  const navRef = useRef<HTMLElement>(null);

  // Sync tab from URL hash if present
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.replace("#", "").toLowerCase() as Tab;
      if (TABS.includes(hash)) {
        setTab(hash);
      }
    }
  }, []);

  const handleTabSelect = (selectedTab: Tab) => {
    setTab(selectedTab);
    if (typeof window !== "undefined") {
      window.location.hash = selectedTab;
    }
  };
  useEffect(() => {
    setTheme(getPreferredTheme());
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (error) toast(error, "error");
  }, [error, toast]);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const prevAddress = useRef<string | null>(null);
  useEffect(() => {
    if (address && !prevAddress.current) {
      toast(`Wallet connected: ${shortId(address)}`, "success");
    } else if (address && prevAddress.current && address !== prevAddress.current) {
      toast(`Active account: ${shortId(address)}`, "success");
    }
    prevAddress.current = address;
  }, [address, toast]);

  // Keyboard navigation for tabs (WCAG 2.1 AA TabList Pattern)
  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex = index;
    if (e.key === "ArrowRight") {
      nextIndex = (index + 1) % TABS.length;
    } else if (e.key === "ArrowLeft") {
      nextIndex = (index - 1 + TABS.length) % TABS.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = TABS.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    handleTabSelect(TABS[nextIndex]);
    const buttons = navRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[nextIndex]?.focus();
  };

  const handleConnectClick = () => {
    if (connected) {
      disconnect();
    } else if (checked && !hasAny) {
      setShowGuidance(true);
    } else {
      connect();
    }
  };

    handleTabSelect(TABS[nextIndex]);
    const buttons = navRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[nextIndex]?.focus();
  };

  const handleConnectClick = () => {
    if (connected) {
      disconnect();
    } else if (checked && !hasAny) {
      setShowGuidance(true);
    } else {
      connect();
    }
  };

  return (
    <NotificationProvider>
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", overflowX: "hidden" }}>
      {/* ── Header ── */}
      <header
        className="shell-header"
        role="banner"
        style={{
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "stretch" : "center",
          gap: isMobile ? 10 : 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.14em", color: "var(--fg-strong)" }}>
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
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.14em", color: "var(--fg-strong)" }}>
            CORE
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            justifyContent: isMobile ? "space-between" : "flex-end",
          }}
        >
          <ContractSwitcher />
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
              background: connected ? STATUS_META.COMPLETED.color : "var(--fg-muted)",
              display: "inline-block",
              boxShadow: connected ? `0 0 6px 2px ${STATUS_META.COMPLETED.glow}` : "none",
              transition: "all 0.3s",
            }}
          />
          {connected && <SessionAuditPanel />}
          <NotificationCenter />
          <button
            data-tour="wallet"
            onClick={() => (connected ? disconnect() : connect())}
            disabled={connecting}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            style={{
              padding: "7px 12px",
              background: "transparent",
              border: `1px solid ${BORDER}`,
              color: DIM,
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              letterSpacing: "0.06em",
              transition: "all 0.2s",
              opacity: connecting ? 0.6 : 1,
              flex: isMobile ? 1 : undefined,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = AMBER;
              e.currentTarget.style.borderColor = AMBER;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = DIM;
              e.currentTarget.style.borderColor = BORDER;
            }}
          >
            {theme === "dark" ? "☀ light" : "☾ dark"}
          </button>
          <div style={{ position: "relative" }}>
            <button
              onClick={() => (connected ? (canSwitch ? setSwitcherOpen((o) => !o) : disconnect()) : connect())}
              disabled={connecting}
              aria-haspopup={canSwitch ? "listbox" : undefined}
              aria-expanded={canSwitch ? switcherOpen : undefined}
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
              {canSwitch ? " ▾" : ""}
            </button>

            {canSwitch && switcherOpen && (
              <div
                role="listbox"
                aria-label="Switch active account"
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  minWidth: 220,
                  background: BG1,
                  border: `1px solid ${BORDER}`,
                  zIndex: 20,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {accounts.map((acct) => {
                  const active = acct === address;
                  return (
                    <button
                      key={acct}
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        if (!active) switchAccount(acct);
                        setSwitcherOpen(false);
                      }}
                      style={{
                        padding: "9px 14px",
                        background: active ? "rgba(245,166,35,0.08)" : "transparent",
                        border: "none",
                        borderBottom: `1px solid ${BORDER}`,
                        color: active ? AMBER : "#aaa",
                        fontFamily: MONO,
                        fontSize: 11,
                        textAlign: "left",
                        cursor: "pointer",
                        letterSpacing: "0.04em",
                      }}
                      onMouseEnter={(e) => {
                        if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                      }}
                      onMouseLeave={(e) => {
                        if (!active) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      {active ? "● " : "○ "}
                      {shortId(acct)}
                    </button>
                  );
                })}
                <button
                  onClick={() => {
                    setSwitcherOpen(false);
                    disconnect();
                  }}
                  style={{
                    padding: "9px 14px",
                    background: "transparent",
                    border: "none",
                    color: DIM,
                    fontFamily: MONO,
                    fontSize: 11,
                    textAlign: "left",
                    cursor: "pointer",
                    letterSpacing: "0.04em",
                  }}
                >
                  disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── No Wallet Guidance Modal ── */}
      {showGuidance && (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            zIndex: 300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setShowGuidance(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <NoWalletGuidance
              onClose={() => setShowGuidance(false)}
              onProceedAnyway={() => {
                setShowGuidance(false);
                connect();
              }}
            />
          </div>
        </div>
      )}

      {/* ── Tab Bar ── */}
      <nav ref={navRef} className="shell-nav" role="tablist" aria-label="Dashboard sections"
        data-tour="nav"
        style={{
          overflowX: isMobile ? "auto" : undefined,
          WebkitOverflowScrolling: "touch",
        }}
      >
        {TABS.map((t, idx) => (
          <button
            key={t}
            id={`tab-${t}`}
            role="tab"
            aria-selected={tab === t}
            aria-controls={`tabpanel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            data-tour={t}
            onClick={() => handleTabSelect(t)}
            onKeyDown={(e) => handleTabKeyDown(e, idx)}
            style={{
              padding: isMobile ? "12px 16px" : "12px 22px",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: "0.1em",
              color: tab === t ? "var(--fg-strong)" : DIM,
              borderBottom: tab === t ? `2px solid ${AMBER}` : "2px solid transparent",
              marginBottom: -1,
              transition: "color 0.15s",
              flex: isMobile ? "1 0 auto" : undefined,
              whiteSpace: "nowrap",
              outlineOffset: "-2px",
            }}
            onMouseEnter={(e) => {
              if (tab !== t) e.currentTarget.style.color = "var(--fg-hover)";
            }}
            onMouseLeave={(e) => {
              if (tab !== t) e.currentTarget.style.color = DIM;
            }}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </nav>

      {/* ── Body ── */}
      <main
        className="shell-main"
        id={`tabpanel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        style={{ overflowX: "hidden" }}
      >
        {tab === "dashboard" && (
          <TabErrorBoundary title="Dashboard tab error">
            <Profiled id="DashboardTab">
              <DashboardTab />
            </Profiled>
          </TabErrorBoundary>
        )}
        {tab === "transactions" && (
          <TabErrorBoundary title="Transactions tab error">
            <Profiled id="TransactionsTab">
              <TransactionsTab />
            </Profiled>
          </TabErrorBoundary>
        )}
        {tab === "analytics" && (
          <TabErrorBoundary title="Analytics tab error">
            <AnalyticsTab />
          </TabErrorBoundary>
        )}
        {tab === "admin" && (
          <TabErrorBoundary title="Admin tab error">
            <Profiled id="AdminTab">
              <AdminTab />
            </Profiled>
          </TabErrorBoundary>
        )}
        {tab === "docs" && (
          <TabErrorBoundary title="Docs tab error">
            <Profiled id="DocsTab">
              <DocsTab />
            </Profiled>
          </TabErrorBoundary>
        )}
      </main>

      {/* ── Footer ── */}
      <footer
        role="contentinfo"
        style={{
          borderTop: `1px solid ${BORDER}`,
          padding: isMobile ? "10px 16px" : "10px 28px",
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          gap: isMobile ? 6 : 0,
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
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
      />
      <ProfilerOverlay />
    </div>
    </NotificationProvider>
  );
}
