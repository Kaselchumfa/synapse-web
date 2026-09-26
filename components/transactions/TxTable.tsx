"use client";
import { memo, useMemo, useRef, useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { AMBER, BG3, BORDER, DIM, MONO } from "@/lib/constants";
import { shortId, elapsed, formatAmount } from "@/lib/utils";
import type { Transaction } from "@/lib/types";

const PAGE_SIZE = 15;
const ROW_HEIGHT = 37;
const VIRTUALIZE_THRESHOLD = 100;
const VIEWPORT_HEIGHT = 560;
const OVERSCAN = 8;

interface TxTableProps {
  txs: Transaction[];
  onSelect: (tx: Transaction) => void;
  query?: string;
}

const HEADERS = ["TX ID", "ASSET", "AMOUNT", "FROM", "TO", "STATUS", "RETRIES", "AGE"];
const ROW_STYLE: CSSProperties = {
  cursor: "pointer",
  borderBottom: `1px solid ${BORDER}`,
  transition: "background 0.15s",
};
const CELL_STYLE: CSSProperties = { padding: "9px 8px" };
const FLEX_CELL_STYLE: CSSProperties = { display: "flex", alignItems: "center" };
const ID_STYLE: CSSProperties = {
  fontSize: 10,
  color: AMBER,
  fontFamily: MONO,
};
const COPY_BUTTON_STYLE: CSSProperties = { marginLeft: 4 };
const ASSET_STYLE: CSSProperties = {
  ...CELL_STYLE,
  fontSize: 10,
  color: "#ccc",
  fontFamily: MONO,
};
const AMOUNT_STYLE: CSSProperties = { ...ASSET_STYLE, color: "#fff" };
const ADDRESS_STYLE: CSSProperties = { ...ID_STYLE, color: DIM };
const RETRIES_STYLE: CSSProperties = { ...ASSET_STYLE, color: DIM, textAlign: "center" };
const AGE_STYLE: CSSProperties = { ...ASSET_STYLE, color: DIM };

interface TxRowProps {
  tx: Transaction;
  onSelect: (tx: Transaction) => void;
}

function hasSameRenderedData(previous: TxRowProps, next: TxRowProps) {
  const previousTx = previous.tx;
  const nextTx = next.tx;

  return (
    previous.onSelect === next.onSelect &&
    previousTx.id === nextTx.id &&
    previousTx.asset === nextTx.asset &&
    previousTx.amount === nextTx.amount &&
    previousTx.from === nextTx.from &&
    previousTx.to === nextTx.to &&
    previousTx.status === nextTx.status &&
    previousTx.retries === nextTx.retries &&
    previousTx.timestamp === nextTx.timestamp
  );
}

const TxRow = memo(function TxRow({ tx, onSelect }: TxRowProps) {
  return (
    <tr
      onClick={() => onSelect(tx)}
      style={ROW_STYLE}
      onMouseEnter={(event) => (event.currentTarget.style.background = BG3)}
      onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
    >
      <td style={CELL_STYLE}>
        <div style={FLEX_CELL_STYLE}>
          <span style={ID_STYLE}>{shortId(tx.id)}</span>
          <CopyButton value={tx.id} label="Tx ID" style={COPY_BUTTON_STYLE} />
        </div>
      </td>
      <td style={ASSET_STYLE}>{tx.asset}</td>
      <td style={AMOUNT_STYLE}>{formatAmount(tx.amount)}</td>
      <td style={CELL_STYLE}>
        <div style={FLEX_CELL_STYLE}>
          <span style={ADDRESS_STYLE}>{tx.from.slice(0, 10)}…</span>
          <CopyButton value={tx.from} label="From address" style={COPY_BUTTON_STYLE} />
        </div>
      </td>
      <td style={CELL_STYLE}>
        <div style={FLEX_CELL_STYLE}>
          <span style={ADDRESS_STYLE}>{tx.to.slice(0, 10)}…</span>
          <CopyButton value={tx.to} label="To address" style={COPY_BUTTON_STYLE} />
        </div>
      </td>
      <td style={CELL_STYLE}>
        <Badge status={tx.status} />
      </td>
      <td style={RETRIES_STYLE}>{tx.retries}</td>
      <td style={AGE_STYLE} suppressHydrationWarning>
        {elapsed(tx.timestamp)}
      </td>
    </tr>
  );
}, hasSameRenderedData);

/**
 * Lightweight client-side fuzzy matcher over the in-memory transaction set.
 * Matches across transaction ID, caller (from) address, and status, ranking
 * results by relevance so partial fragments surface the most likely rows first.
 */
function fuzzyScore(tx: Transaction, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;

  const fields: Array<{ value: string; weight: number }> = [
    { value: tx.id.toLowerCase(), weight: 3 },
    { value: tx.from.toLowerCase(), weight: 2 },
    { value: tx.status.toLowerCase(), weight: 1 },
  ];

  let best = 0;
  for (const { value, weight } of fields) {
    if (value === needle) {
      best = Math.max(best, weight * 100);
      continue;
    }
    const index = value.indexOf(needle);
    if (index !== -1) {
      // Earlier matches and longer contiguous matches rank higher.
      const proximity = 1 - index / Math.max(value.length, 1);
      best = Math.max(best, weight * (50 + proximity * 40 + needle.length));
      continue;
    }
    // Subsequence (fuzzy) match: all query chars appear in order.
    let cursor = 0;
    let gaps = 0;
    for (const char of needle) {
      const found = value.indexOf(char, cursor);
      if (found === -1) {
        cursor = -1;
        break;
      }
      gaps += found - cursor;
      cursor = found + 1;
    }
    if (cursor !== -1) {
      best = Math.max(best, weight * (10 + needle.length - gaps / Math.max(value.length, 1)));
    }
  }
  return best;
}

interface VirtualizedRowsProps {
  txs: Transaction[];
  onSelect: (tx: Transaction) => void;
}

/**
 * Windowed row renderer. Only the rows intersecting the scroll viewport (plus
 * a small overscan buffer) are mounted, so 10k+ row histories stay smooth.
 * Rendered as real <tr> elements inside the parent <tbody> to preserve table
 * semantics for screen readers and keyboard navigation.
 */
function VirtualizedRows({ txs, onSelect }: VirtualizedRowsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: txs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const items = virtualizer.getVirtualItems();
  const paddingTop = items.length > 0 ? items[0].start : 0;
  const paddingBottom =
    items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;

  return (
    <div
      ref={scrollRef}
      style={{ maxHeight: VIEWPORT_HEIGHT, overflowY: "auto", overflowX: "auto" }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
        <thead>
          <tr>
            {HEADERS.map((header) => (
              <th
                key={header}
                style={{
                  padding: "4px 8px 10px",
                  fontSize: 9,
                  letterSpacing: "0.1em",
                  color: DIM,
                  fontFamily: MONO,
                  textAlign: "left",
                  borderBottom: `1px solid ${BORDER}`,
                  whiteSpace: "nowrap",
                }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr aria-hidden="true">
              <td colSpan={8} style={{ height: paddingTop, padding: 0, border: 0 }} />
            </tr>
          )}
          {items.map((item) => {
            const tx = txs[item.index];
            return <TxRow key={tx.id} tx={tx} onSelect={onSelect} />;
          })}
          {paddingBottom > 0 && (
            <tr aria-hidden="true">
              <td colSpan={8} style={{ height: paddingBottom, padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function TxTable({ txs, onSelect, query = "" }: TxTableProps) {
  const [page, setPage] = useState(1);
  const [knownLength, setKnownLength] = useState(txs.length);
  if (txs.length !== knownLength) {
    setKnownLength(txs.length);
    setPage(1);
  }

  const filteredTxs = useMemo(() => {
    const needle = query.trim();
    if (!needle) return txs;
    return txs
      .map((tx) => ({ tx, score: fuzzyScore(tx, needle) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.tx);
  }, [txs, query]);

  const virtualize = filteredTxs.length > VIRTUALIZE_THRESHOLD;

  const totalPages = Math.max(1, Math.ceil(filteredTxs.length / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const pageTxs = filteredTxs.slice(start, start + PAGE_SIZE);

  if (virtualize) {
    return (
      <div>
        {filteredTxs.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: DIM,
              fontFamily: MONO,
              fontSize: 11,
            }}
          >
            no transactions match filter
          </div>
        ) : (
          <VirtualizedRows txs={filteredTxs} onSelect={onSelect} />
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr>
              {HEADERS.map((header) => (
                <th
                  key={header}
                  style={{
                    padding: "4px 8px 10px",
                    fontSize: 9,
                    letterSpacing: "0.1em",
                    color: DIM,
                    fontFamily: MONO,
                    textAlign: "left",
                    borderBottom: `1px solid ${BORDER}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageTxs.map((tx) => (
              <TxRow key={tx.id} tx={tx} onSelect={onSelect} />
            ))}
            {filteredTxs.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    padding: 24,
                    textAlign: "center",
                    color: DIM,
                    fontFamily: MONO,
                    fontSize: 11,
                  }}
                >
                  no transactions match filter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filteredTxs.length > PAGE_SIZE && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 12,
            paddingTop: 10,
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              padding: "6px 14px",
              background: "transparent",
              border: `1px solid ${BORDER}`,
              color: page === 1 ? DIM : "#ccc",
              cursor: page === 1 ? "not-allowed" : "pointer",
              opacity: page === 1 ? 0.5 : 1,
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "0.06em",
            }}
          >
            ← PREV
          </button>
          <span style={{ fontSize: 10, color: DIM, fontFamily: MONO }}>
            PAGE {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              padding: "6px 14px",
              background: "transparent",
              border: `1px solid ${BORDER}`,
              color: page === totalPages ? DIM : "#ccc",
              cursor: page === totalPages ? "not-allowed" : "pointer",
              opacity: page === totalPages ? 0.5 : 1,
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "0.06em",
            }}
          >
            NEXT →
          </button>
        </div>
      )}
    </div>
  );
}
