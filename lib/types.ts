export type TxStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface Transaction {
  id: string;
  asset: string;
  amount: number;
  status: TxStatus;
  timestamp: number;
  from: string;
  to: string;
  memo: string;
  callback_url: string;
  retries: number;
  created_at: number;
}

export interface ContractInfo {
  version: string;
  network: string;
  address: string;
  admin: string;
  relay_signer: string;
  health: string;
}

export interface StatusMeta {
  color: string;
  bg: string;
  glow: string;
  label: string;
}

export interface CallbackPayload {
  tx_id: string;
  callback_url: string;
  secret: string;
}

/**
 * Fields of a Transaction that the advanced multi-field client-side search
 * matches against. Kept as a shared type so the search UI and any ranking
 * helpers stay in sync with the transaction model.
 */
export type TxSearchField = "id" | "from" | "status";

export interface TxSearchOptions {
  /** Raw query string entered by the user. */
  query: string;
  /** Fields to match across; defaults to id, from and status. */
  fields?: TxSearchField[];
  /** Minimum fuzzy score (0-1) required for a match. */
  threshold?: number;
}

export interface TxSearchResult {
  transaction: Transaction;
  /** Relevance score in the 0-1 range, higher is more relevant. */
  score: number;
  /** Fields that contributed to the match. */
  matchedFields: TxSearchField[];
}
