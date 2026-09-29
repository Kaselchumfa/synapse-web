"use client";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { scValToNative } from "@stellar/stellar-sdk";
import { TxTable } from "./TxTable";
import { TxDetailModal } from "./TxDetailModal";
import { TxCompareView } from "./TxCompareView";
import { Panel } from "@/components/ui/Panel";
import { Field } from "@/components/ui/Field";
import { SorobanTip } from "@/components/ui/SorobanTip";
import { ActionButton } from "@/components/ui/ActionButton";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useSoroban } from "@/lib/soroban/SorobanProvider";
import { invokeContract, simulateContractCall, stringArg, structArg } from "@/lib/soroban/contract";
import { useLiveTransactions } from "@/lib/soroban/useLiveTransactions";
import { shortId } from "@/lib/utils";
import { AMBER, BG3, BORDER, DIM, MONO } from "@/lib/constants";
import {
  createSavedView,
  loadSavedViews,
  persistSavedViews,
  type SavedView,
  type SavedViewFilters,
} from "@/lib/filters/savedViews";
import { toCsv, toJson, downloadBlob } from "@/lib/export/formatters";
import type { Transaction } from "@/lib/types";

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID;
const MAX_COMPARE = 4;

const SEARCH_DEBOUNCE_MS = 200;

/**
 * Score a single transaction against a fuzzy query across tx id, caller
 * address, and status. Returns 0 when there is no match, otherwise a
 * relevance score (higher = better).
 */
function scoreTx(tx: Transaction, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const fields: Array<{ value: string; weight: number }> = [
    { value: tx.id, weight: 3 },
    { value: tx.caller ?? "", weight: 2 },
    { value: tx.status, weight: 1 },
  ];
  let best = 0;
  for (const { value, weight } of fields) {
    const hay = value.toLowerCase();
    if (!hay) continue;
    let score = 0;
    if (hay === q) {
      score = 100;
    } else if (hay.startsWith(q)) {
      score = 80;
    } else if (hay.includes(q)) {
      score = 60;
    } else {
      // subsequence (fuzzy) match: all query chars appear in order
      let qi = 0;
      for (let i = 0; i < hay.length && qi < q.length; i++) {
        if (hay[i] === q[qi]) qi++;
      }
      if (qi === q.length) score = 30;
    }
    if (score > 0) best = Math.max(best, score * weight);
  }
  return best;
}

export function TransactionsTab() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [cb, setCb] = useState({ tx_id: "", callback_url: "", secret: "" });
  const [lookingUp, setLookingUp] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewName, setViewName] = useState("");
  const txs = useLiveTransactions();
  const { address, connect } = useWallet();
  const { contractId } = useSoroban();
  const { toast } = useToast();

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  // Hydrate filter + selected transaction from the URL query string.
  useEffect(() => {
    const urlFilter = searchParams.get("filter") ?? "";
    setFilter((prev) => (prev === urlFilter ? prev : urlFilter));

    const txId = searchParams.get("tx_id");
    if (!txId) {
      setSelected((prev) => (prev === null ? prev : null));
      return;
    }
    const match = txs.find((t) => t.id === txId);
    // Malformed/stale tx_id that no longer resolves is ignored gracefully.
    setSelected((prev) => (prev?.id === match?.id ? prev : match ?? null));
  }, [searchParams, txs]);

  function syncUrl(nextFilter: string, nextSelected: Transaction | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextFilter) params.set("filter", nextFilter);
    else params.delete("filter");
    if (nextSelected) params.set("tx_id", nextSelected.id);
    else params.delete("tx_id");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function updateFilter(value: string) {
    setFilter(value);
    syncUrl(value, selected);
  }

  function updateSelected(tx: Transaction | null) {
    setSelected(tx);
    syncUrl(filter, tx);
  }

  // Load persisted views once on mount (per-browser persistence).
  useEffect(() => {
    setSavedViews(loadSavedViews());
  }, []);

  function currentFilters(): SavedViewFilters {
    return { status, dateFrom, dateTo, search: filter };
  }

  function applyFilters(f: SavedViewFilters) {
    setStatus(f.status ?? "");
    setDateFrom(f.dateFrom ?? "");
    setDateTo(f.dateTo ?? "");
    setFilter(f.search ?? "");
  }

  function commit(next: SavedView[]) {
    setSavedViews(next);
    persistSavedViews(next);
  }

  function handleSaveView() {
    const name = viewName.trim();
    if (!name) {
      toast("Enter a name for the saved view", "error");
      return;
    }
    const view = createSavedView(name, currentFilters());
    commit([...savedViews, view]);
    setActiveViewId(view.id);
    setViewName("");
    toast(`Saved view "${view.name}"`, "success");
  }

  function handleSwitchView(view: SavedView) {
    applyFilters(view.filters);
    setActiveViewId(view.id);
  }

  function handleRenameView(view: SavedView) {
    const next = window.prompt("Rename saved view", view.name);
    if (next === null) return;
    const name = next.trim();
    if (!name) {
      toast("View name cannot be empty", "error");
      return;
    }
    commit(savedViews.map((v) => (v.id === view.id ? { ...v, name } : v)));
  }

  function handleDeleteView(view: SavedView) {
    commit(savedViews.filter((v) => v.id !== view.id));
    if (activeViewId === view.id) setActiveViewId(null);
  }

  function toggleCompare(id: string) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) {
        toast(`You can compare at most ${MAX_COMPARE} transactions`, "error");
        return prev;
      }
      return [...prev, id];
    });
  }

  const compareTxs = txs.filter((t) => compareIds.includes(t.id));

  async function runLookup() {
    if (!filter.trim()) {
      toast("Enter a tx_id to look up", "error");
      return;
    }
    if (!contractId) {
      toast("No contract ID is currently selected or configured", "error");
      return;
    }
    if (!address) {
      toast("Connect a wallet to run this read-only lookup", "error");
      await connect();
      return;
    }
    setLookingUp(true);
    try {
      const simulated = await simulateContractCall(
        RPC_URL,
        contractId,
        address,
        "get_transaction",
        [stringArg(filter.trim())]
      );
      const value = simulated.result ? scValToNative(simulated.result.retval) : undefined;
      toast(`get_transaction(${shortId(filter.trim())}) → ${JSON.stringify(value)}`, "info");
    } catch (err) {
      toast(err instanceof Error ? err.message : "get_transaction() failed", "error");
    } finally {
      setLookingUp(false);
    }
  }

  async function runRegisterCallback() {
    if (!cb.tx_id.trim() || !cb.callback_url.trim() || !cb.secret.trim()) {
      toast("tx_id, callback_url, and secret are all required", "error");
      return;
    }
    if (!contractId) {
      toast("No contract ID is currently selected or configured", "error");
      return;
    }
    if (!address) {
      toast("Connect a wallet before registering a callback", "error");
      await connect();
      return;
    }
    setRegistering(true);
    try {
      const payload = structArg({
        tx_id: cb.tx_id.trim(),
        callback_url: cb.callback_url.trim(),
        secret: cb.secret.trim(),
      });
      const result = await invokeContract(RPC_URL, contractId, address, "register_callback", [
        payload,
      ]);
      toast(
        `register_callback() ${result.status === "SUCCESS" ? "succeeded" : "failed"} · tx ${shortId(result.hash)}`,
        result.status === "SUCCESS" ? "success" : "error"
      );
      if (result.status === "SUCCESS") {
        setCb({ tx_id: "", callback_url: "", secret: "" });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "register_callback() failed", "error");
    } finally {
      setRegistering(false);
    }
  }

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim();
    const base = q
      ? txs
          .map((t) => ({ t, score: scoreTx(t, q) }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score)
          .map(({ t }) => t)
      : txs;
    return base.filter((t) => {
      const matchesSearch =
        !filter ||
        t.id.includes(filter) ||
        t.status.includes(filter.toUpperCase()) ||
        t.asset.includes(filter.toUpperCase()) ||
        t.memo.includes(filter);
      const matchesStatus = !status || t.status === status.toUpperCase();
      const ts = new Date(t.created_at ?? 0).getTime();
      const matchesFrom = !dateFrom || ts >= new Date(dateFrom).getTime();
      const matchesTo = !dateTo || ts <= new Date(dateTo).getTime();
      return matchesSearch && matchesStatus && matchesFrom && matchesTo;
    });
  }, [txs, debouncedSearch, filter, status, dateFrom, dateTo]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} className="animate-fade-in">
      {selected && <TxDetailModal tx={selected} onClose={() => setSelected(null)} />}
      {comparing && compareTxs.length >= 2 && (
        <TxCompareView txs={compareTxs} onClose={() => setComparing(false)} />
      )}

      {/* Saved views */}
      <Panel title="SAVED VIEWS">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {savedViews.length === 0 && (
            <span style={{ color: "#888", fontFamily: MONO, fontSize: 11 }}>
              No saved views yet — set filters below and save one.
            </span>
          )}
          {savedViews.map((view) => (
            <span
              key={view.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: `1px solid ${activeViewId === view.id ? AMBER : BORDER}`,
                background: BG3,
                padding: "4px 8px",
                fontFamily: MONO,
                fontSize: 11,
              }}
            >
              <button
                onClick={() => handleSwitchView(view)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: activeViewId === view.id ? AMBER : "#ddd",
                  fontFamily: MONO,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {view.name}
              </button>
              <button
                onClick={() => handleRenameView(view)}
                title="Rename"
                style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer" }}
              >
                ✎
              </button>
              <button
                onClick={() => handleDeleteView(view)}
                title="Delete"
                style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer" }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder="name this filter set…"
            style={{
              flex: 1,
              background: BG3,
              border: `1px solid ${BORDER}`,
              color: "#eee",
              fontFamily: MONO,
              fontSize: 12,
              padding: "9px 12px",
              outline: "none",
            }}
          />
          <button
            onClick={handleSaveView}
            style={{
              padding: "9px 20px",
              background: "transparent",
              border: `1px solid ${AMBER}55`,
              color: AMBER,
              fontFamily: MONO,
              fontSize: 11,
              cursor: "pointer",
              letterSpacing: "0.06em",
            }}
          >
            SAVE VIEW
          </button>
        </div>
      </Panel>

      {/* Lookup */}
      <Panel title="TRANSACTION LOOKUP">
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={filter}
            onChange={(e) => updateFilter(e.target.value)}
            placeholder="filter by tx_id · status · asset · memo…"
            aria-label="Filter transactions by ID, status, asset, or memo"
            style={{
              flex: 1,
              background: BG3,
              border: `1px solid ${BORDER}`,
              color: "#eee",
              fontFamily: MONO,
              fontSize: 12,
              padding: "9px 12px",
              outline: "none",
            }}
            onFocus={(e) => (e.target.style.borderColor = "rgba(245,166,35,0.45)")}
            onBlur={(e) => (e.target.style.borderColor = BORDER)}
          />
          <button
            onClick={runLookup}
            disabled={lookingUp}
            style={{
              padding: "9px 20px",
              background: "transparent",
              border: `1px solid ${AMBER}55`,
              color: AMBER,
              fontFamily: MONO,
              fontSize: 11,
              cursor: lookingUp ? "wait" : "pointer",
              opacity: lookingUp ? 0.6 : 1,
              letterSpacing: "0.06em",
            }}
          >
            {lookingUp ? "LOOKING UP…" : "LOOKUP →"}
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
          <Field label="status" value={status} onChange={setStatus} placeholder="SUCCESS…" />
          <Field label="date from" value={dateFrom} onChange={setDateFrom} placeholder="YYYY-MM-DD" />
          <Field label="date to" value={dateTo} onChange={setDateTo} placeholder="YYYY-MM-DD" />
        </div>
        <SorobanTip>
          get_transaction(tx_id: string) → Transaction struct; read-only simulation, no signing
        </SorobanTip>
      </Panel>

      {/* Full table */}
      <Panel title={`ALL TRANSACTIONS (${filtered.length})`}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search tx_id · caller · status…"
          aria-label="Search transactions"
          style={{
            width: "100%",
            boxSizing: "border-box",
            marginBottom: 10,
            background: BG3,
            border: `1px solid ${BORDER}`,
            color: "#eee",
            fontFamily: MONO,
            fontSize: 12,
            padding: "9px 12px",
            outline: "none",
          }}
          onFocus={(e) => (e.target.style.borderColor = "rgba(245,166,35,0.45)")}
          onBlur={(e) => (e.target.style.borderColor = BORDER)}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 10 }}>
          <button
            onClick={() => downloadBlob(toCsv(filtered), `transactions-${Date.now()}.csv`, "text/csv;charset=utf-8;")}
            disabled={filtered.length === 0}
            aria-label="Export as CSV"
            style={{
              padding: "5px 12px",
              background: "transparent",
              border: `1px solid ${BORDER}`,
              color: filtered.length === 0 ? DIM : "#ccc",
              fontFamily: MONO,
              fontSize: 9,
              letterSpacing: "0.1em",
              cursor: filtered.length === 0 ? "not-allowed" : "pointer",
              opacity: filtered.length === 0 ? 0.4 : 1,
              transition: "border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => { if (filtered.length > 0) { e.currentTarget.style.borderColor = AMBER; e.currentTarget.style.color = AMBER; } }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = "#ccc"; }}
          >
            ↓ CSV
          </button>
          <button
            onClick={() => downloadBlob(toJson(filtered), `transactions-${Date.now()}.json`, "application/json")}
            disabled={filtered.length === 0}
            aria-label="Export as JSON"
            style={{
              padding: "5px 12px",
              background: "transparent",
              border: `1px solid ${BORDER}`,
              color: filtered.length === 0 ? DIM : "#ccc",
              fontFamily: MONO,
              fontSize: 9,
              letterSpacing: "0.1em",
              cursor: filtered.length === 0 ? "not-allowed" : "pointer",
              opacity: filtered.length === 0 ? 0.4 : 1,
              transition: "border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => { if (filtered.length > 0) { e.currentTarget.style.borderColor = AMBER; e.currentTarget.style.color = AMBER; } }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = "#ccc"; }}
          >
            ↓ JSON
          </button>
        </div>
        <TxTable
          txs={filtered}
          onSelect={setSelected}
          compareIds={compareIds}
          onToggleCompare={toggleCompare}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 12,
          }}
        >
          <ActionButton
            label={`COMPARE SELECTED (${compareIds.length}/${MAX_COMPARE})`}
            color={AMBER}
            disabled={compareIds.length < 2}
            onClick={() => setComparing(true)}
          />
          {compareIds.length > 0 && (
            <button
              onClick={() => setCompareIds([])}
              style={{
                background: "transparent",
                border: `1px solid ${BORDER}`,
                color: "#aaa",
                fontFamily: MONO,
                fontSize: 11,
                padding: "8px 14px",
                cursor: "pointer",
              }}
            >
              CLEAR
            </button>
          )}
        </div>
      </Panel>

      {/* Callback registration */}
      <Panel title="REGISTER CALLBACK">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.5fr 1fr",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <Field
            label="tx_id"
            value={cb.tx_id}
            onChange={(v) => setCb((p) => ({ ...p, tx_id: v }))}
            placeholder="uuid…"
          />
          <Field
            label="callback_url"
            value={cb.callback_url}
            onChange={(v) => setCb((p) => ({ ...p, callback_url: v }))}
            placeholder="https://…"
          />
          <Field
            label="secret"
            value={cb.secret}
            onChange={(v) => setCb((p) => ({ ...p, secret: v }))}
            placeholder="hmac-secret"
            type="password"
          />
        </div>
        <ActionButton
          label={registering ? "SUBMITTING…" : "REGISTER CALLBACK →"}
          color={AMBER}
          disabled={registering}
          onClick={runRegisterCallback}
        />
        <SorobanTip>
          register_callback(payload: CallbackPayload) → signed by relay_signer keypair via
          TransactionBuilder
        </SorobanTip>
      </Panel>
    </div>
  );
}
