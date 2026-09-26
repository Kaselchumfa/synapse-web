"use client";
import { useState } from "react";
import { StatCards } from "./StatCards";
import { Pipeline } from "./Pipeline";
import { ContractInfoPanel } from "./ContractInfoPanel";
import { HealthWidget } from "./HealthWidget";
import { RecentTxTable } from "./RecentTxTable";
import { TxDetailModal } from "@/components/transactions/TxDetailModal";
import { useLiveTransactions } from "@/lib/soroban/useLiveTransactions";
import { useLiveContractInfo } from "@/lib/soroban/useLiveContractInfo";
import type { Transaction } from "@/lib/types";

export function DashboardTab() {
  const [selected, setSelected] = useState<Transaction | null>(null);
  const txs = useLiveTransactions();
  const contractInfo = useLiveContractInfo();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} className="animate-fade-in">
      {selected && <TxDetailModal tx={selected} onClose={() => setSelected(null)} />}
      <StatCards txs={txs} />
      <Pipeline txs={txs} />
      <div className="dashboard-grid">
        <ContractInfoPanel info={contractInfo} />
        <HealthWidget />
        <RecentTxTable txs={txs} onSelect={setSelected} />
      </div>
    </div>
  );
}
