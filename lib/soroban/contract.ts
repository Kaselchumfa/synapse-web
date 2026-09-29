import {
  BASE_FEE,
  Contract,
  FeeBumpTransaction,
  TransactionBuilder,
  rpc,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import { StellarWalletsKit } from "@/lib/wallet/kit";

export { addressArg, stringArg, structArg } from "./args";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

/**
 * Default number of ledgers (~5s each) a submission may stay pending before the
 * UI offers the "speed up" fee-bump action. Configurable per call site.
 */
export const DEFAULT_FEE_BUMP_THRESHOLD_LEDGERS = 12;

/**
 * Multiplier applied to the simulated resource fee when building a fee-bump,
 * so the replacement transaction outbids the original during congestion.
 */
const FEE_BUMP_MULTIPLIER = 2;

/**
 * How long (ms) an endpoint stays tripped after a failure before it is eligible
 * for a health probe again. Prevents rapid flapping between endpoints.
 */
const ENDPOINT_COOLDOWN_MS = 30_000;

/**
 * Interval (ms) between background health checks of the configured endpoints.
 */
const HEALTH_CHECK_INTERVAL_MS = 15_000;

/**
 * Number of consecutive failures required before an endpoint is considered
 * unhealthy. Provides hysteresis so a single transient error does not trip the
 * circuit breaker.
 */
const FAILURE_THRESHOLD = 2;

export interface ContractCallResult {
  status: "SUCCESS" | "FAILED";
  hash: string;
}

/**
 * Estimated network fee (in stroops) for a contract invocation, derived from
 * the resource usage reported by `simulateContractCall`. Shown in the
 * simulation-preview flow before every signed submission.
 */
export interface FeeEstimate {
  /** Total estimated fee in stroops (inclusion fee + simulated resource fee). */
  totalStroops: number;
  /** Inclusion fee component in stroops. */
  inclusionStroops: number;
  /** Simulated resource fee component in stroops. */
  resourceStroops: number;
}

/**
 * Per-endpoint circuit-breaker state. Tracks consecutive failures, the last
 * observed latency, and the timestamp until which the endpoint is tripped.
 */
export interface RpcEndpointState {
  url: string;
  /** Priority order (lower = more preferred). */
  priority: number;
  healthy: boolean;
  consecutiveFailures: number;
  /** Epoch ms until which the endpoint is tripped (0 = not tripped). */
  trippedUntil: number;
  /** Last measured round-trip latency in ms (Infinity when unknown). */
  latencyMs: number;
}

/**
 * Resolves the priority-ordered list of RPC endpoints from configuration.
 * `NEXT_PUBLIC_SOROBAN_RPC_URLS` (comma-separated) takes precedence, falling
 * back to the single `NEXT_PUBLIC_SOROBAN_RPC_URL` for backwards compatibility.
 */
export function getConfiguredRpcEndpoints(): string[] {
  const multi = process.env.NEXT_PUBLIC_SOROBAN_RPC_URLS;
  const single = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
  const raw = multi && multi.trim().length > 0 ? multi : single ?? "";
  return raw
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

/**
 * Client-side multi-RPC endpoint selector with per-endpoint circuit breakers,
 * periodic background health checks, latency-aware selection, and automatic
 * failover/failback. Entirely browser-side — no backend proxy involved.
 */
export class RpcEndpointManager {
  private endpoints: RpcEndpointState[];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(urls: string[] = getConfiguredRpcEndpoints()) {
    this.endpoints = urls.map((url, index) => ({
      url,
      priority: index,
      healthy: true,
      consecutiveFailures: 0,
      trippedUntil: 0,
      latencyMs: Infinity,
    }));
  }

  /** Returns the current endpoint states (for diagnostics/tests). */
  getStates(): RpcEndpointState[] {
    return this.endpoints.map((e) => ({ ...e }));
  }

  /**
   * Selects the best healthy endpoint: preferred by priority, then by lowest
   * measured latency. Tripped endpoints are skipped until their cooldown
   * elapses, at which point they become eligible for failback.
   */
  selectEndpoint(now: number = Date.now()): string | null {
    const eligible = this.endpoints.filter(
      (e) => e.healthy && (e.trippedUntil === 0 || now >= e.trippedUntil)
    );
    if (eligible.length === 0) {
      // All endpoints tripped: fall back to the highest-priority one so the
      // caller still has a chance to recover rather than failing outright.
      return this.endpoints.length > 0 ? this.endpoints[0].url : null;
    }
    eligible.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.latencyMs - b.latencyMs;
    });
    return eligible[0].url;
  }

  /** Records a successful call against an endpoint, clearing its breaker. */
  recordSuccess(url: string, latencyMs: number = Infinity): void {
    const endpoint = this.endpoints.find((e) => e.url === url);
    if (!endpoint) return;
    endpoint.healthy = true;
    endpoint.consecutiveFailures = 0;
    endpoint.trippedUntil = 0;
    if (Number.isFinite(latencyMs)) endpoint.latencyMs = latencyMs;
  }

  /**
   * Records a failure against an endpoint. Once the failure threshold is
   * reached the endpoint is tripped for the cooldown window, enabling failover
   * without rapid flapping on transient errors.
   */
  recordFailure(url: string, now: number = Date.now()): void {
    const endpoint = this.endpoints.find((e) => e.url === url);
    if (!endpoint) return;
    endpoint.consecutiveFailures += 1;
    if (endpoint.consecutiveFailures >= FAILURE_THRESHOLD) {
      endpoint.healthy = false;
      endpoint.trippedUntil = now + ENDPOINT_COOLDOWN_MS;
    }
  }

  /**
   * Probes a single endpoint with a lightweight read and updates its breaker
   * state. Returns true when the endpoint responded successfully.
   */
  async checkEndpoint(url: string, now: number = Date.now()): Promise<boolean> {
    const started = now;
    try {
      const server = new rpc.Server(url);
      await server.getLatestLedger();
      this.recordSuccess(url, Date.now() - started);
      return true;
    } catch {
      this.recordFailure(url, now);
      return false;
    }
  }

  /** Runs a health check across every configured endpoint. */
  async checkAll(): Promise<void> {
    await Promise.all(this.endpoints.map((e) => this.checkEndpoint(e.url)));
  }

  /**
   * Starts periodic background health checks. Safe to call multiple times —
   * an existing timer is cleared first.
   */
  startHealthChecks(intervalMs: number = HEALTH_CHECK_INTERVAL_MS): void {
    this.stopHealthChecks();
    this.timer = setInterval(() => {
      void this.checkAll();
    }, intervalMs);
  }

  /** Stops the periodic background health checks. */
  stopHealthChecks(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/**
 * Builds, simulates, signs (via the connected wallet), submits, and polls a
 * Soroban contract invocation to completion.
 */
export async function invokeContract(
  rpcUrl: string,
  contractId: string,
  sourceAddress: string,
  method: string,
  args: xdr.ScVal[] = []
): Promise<ContractCallResult> {
  const server = new rpc.Server(rpcUrl);
  const account = await server.getAccount(sourceAddress);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);

  const { signedTxXdr } = await StellarWalletsKit.signTransaction(prepared.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
    address: sourceAddress,
  });

  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE) as Transaction;
  const sendResult = await server.sendTransaction(signedTx);

  if (sendResult.status === "ERROR") {
    throw new Error(`Transaction rejected by network: ${sendResult.hash}`);
  }

  const final = await server.pollTransaction(sendResult.hash);

  return {
    status: final.status === rpc.Api.GetTransactionStatus.SUCCESS ? "SUCCESS" : "FAILED",
    hash: sendResult.hash,
  };
}

/**
 * Runs a read-only contract simulation (no signing, no submission) — used for
 * simple accessor methods like health()/version() that don't mutate state.
 */
export async function simulateContractCall(
  rpcUrl: string,
  contractId: string,
  sourceAddress: string,
  method: string,
  args: xdr.ScVal[] = []
) {
  const server = new rpc.Server(rpcUrl);
  const account = await server.getAccount(sourceAddress);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(simulated.error);
  }
  return simulated;
}

/**
 * Estimates the network fee for a contract invocation from the resource usage
 * reported by `simulateContractCall`. Used by the simulation-preview flow to
 * surface the cost before the user signs.
 */
export async function estimateContractCallFee(
  rpcUrl: string,
  contractId: string,
  sourceAddress: string,
  method: string,
  args: xdr.ScVal[] = []
): Promise<FeeEstimate> {
  const simulated = await simulateContractCall(
    rpcUrl,
    contractId,
    sourceAddress,
    method,
    args
  );

  const inclusionStroops = Number(BASE_FEE);
  const resourceStroops = Number(simulated.minResourceFee ?? 0);

  return {
    totalStroops: inclusionStroops + resourceStroops,
    inclusionStroops,
    resourceStroops,
  };
}

/**
 * Builds a correctly-formed fee-bump transaction that replaces a stuck
 * submission. The fee-bump is signed by the fee source (the connected wallet)
 * and must be explicitly triggered by the user — never automatically.
 *
 * If the original transaction has already confirmed, the caller should treat
 * the resulting submission error as a benign stale-state condition rather than
 * a bug (see `isAlreadyConfirmedError`).
 */
export async function buildFeeBumpTransaction(
  rpcUrl: string,
  innerTxXdr: string,
  feeSourceAddress: string,
  baseFeeStroops: number = BASE_FEE
): Promise<FeeBumpTransaction> {
  const server = new rpc.Server(rpcUrl);
  const innerTx = TransactionBuilder.fromXDR(innerTxXdr, NETWORK_PASSPHRASE) as Transaction;

  const bumpedFee = Math.max(
    Number(baseFeeStroops) * FEE_BUMP_MULTIPLIER,
    Number(innerTx.fee) * FEE_BUMP_MULTIPLIER
  );

  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    feeSourceAddress,
    bumpedFee.toString(),
    innerTx,
    NETWORK_PASSPHRASE
  );

  // Ensure the fee source account exists on the network before signing.
  await server.getAccount(feeSourceAddress);

  return feeBump;
}

/**
 * Signs and submits a fee-bump transaction built by `buildFeeBumpTransaction`.
 * Requires an explicit user signature via the connected wallet.
 */
export async function submitFeeBumpTransaction(
  rpcUrl: string,
  feeBump: FeeBumpTransaction,
  feeSourceAddress: string
): Promise<ContractCallResult> {
  const server = new rpc.Server(rpcUrl);

  const { signedTxXdr } = await StellarWalletsKit.signTransaction(feeBump.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
    address: feeSourceAddress,
  });

  const signedTx = TransactionBuilder.fromXDR(
    signedTxXdr,
    NETWORK_PASSPHRASE
  ) as FeeBumpTransaction;

  const sendResult = await server.sendTransaction(signedTx);

  if (sendResult.status === "ERROR") {
    throw new Error(`Fee-bump rejected by network: ${sendResult.hash}`);
  }

  const final = await server.pollTransaction(sendResult.hash);

  return {
    status: final.status === rpc.Api.GetTransactionStatus.SUCCESS ? "SUCCESS" : "FAILED",
    hash: sendResult.hash,
  };
}

/**
 * Returns true when a fee-bump submission failed because the original
 * transaction already confirmed in the interim. Callers should surface this as
 * an informational "already confirmed" state, not as a bug.
 */
export function isAlreadyConfirmedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already (confirmed|included|applied)|tx_bad_seq|tx_too_late/i.test(message);
}
