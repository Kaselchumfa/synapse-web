"use client";
import { useEffect, useMemo, useState } from "react";
import { scValToNative } from "@stellar/stellar-sdk";
import { TxTable } from "./TxTable";
import { TxDetailModal } from "./TxDetailModal";
import { Panel } from "@/components/ui/Panel";
import { Field } from "@/components/ui/Field";
import { SorobanTip } from "@/components/ui/SorobanTip";
import { ActionButton } from "@/components/ui/ActionButton";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { invokeContract, simulateContractCall, stringArg, structArg } from "@/lib/soroban/contract";
import { useLiveTransactions } from "@/lib/soroban/useLiveTransactions";
import { shortId } from "@/lib/utils";
import { AMBER, BG3, BORDER, MONO } from "@/lib/constants";
import type { Transaction } from "@/lib/types";

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID;

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
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [cb, setCb] = useState({ tx_id: "", callback_url: "", secret: "" });
  const [lookingUp, setLookingUp] = useState(false);
  const [registering, setRegistering] = useState(false);
  const txs = useLiveTransactions();
  const { address, connect } = useWallet();
  const { toast } = useToast();

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  async function runLookup() {
    if (!filter.trim()) {
      toast("Enter a tx_id to look up", "error");
      return;
    }
    if (!CONTRACT_ID) {
      toast("NEXT_PUBLIC_CONTRACT_ID is not configured", "error");
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
        CONTRACT_ID,
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
    if (!CONTRACT_ID) {
      toast("NEXT_PUBLIC_CONTRACT_ID is not configured", "error");
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
      const result = await invokeContract(RPC_URL, CONTRACT_ID, address, "register_callback", [
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
    if (!q) return txs;
    return txs
      .map((t) => ({ t, score: scoreTx(t, q) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ t }) => t);
  }, [txs, debouncedSearch]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} className="animate-fade-in">
      {selected && <TxDetailModal tx={selected} onClose={() => setSelected(null)} />}

      {/* Lookup */}
      <Panel title="TRANSACTION LOOKUP">
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter by tx_id · status · asset · memo…"
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
        <TxTable txs={filtered} onSelect={setSelected} />
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
