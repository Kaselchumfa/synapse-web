"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createSorobanEventPoller,
  type NormalizedSorobanEvent,
  type RpcHealth,
  type SorobanEventPoller,
} from "./events";

export interface SorobanEnvironment {
  name: string;
  rpcUrl: string;
  networkPassphrase: string;
}

export const SOROBAN_ENVIRONMENTS: SorobanEnvironment[] = [
  {
    name: "Testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
  {
    name: "Futurenet",
    rpcUrl: "https://rpc-futurenet.stellar.org",
    networkPassphrase: "Test SDF Future Network ; October 2022",
  },
];

export const DEFAULT_ENVIRONMENT: SorobanEnvironment = SOROBAN_ENVIRONMENTS[0];

const STORAGE_KEY = "soroban:environment";

function isEnvironment(value: unknown): value is SorobanEnvironment {
  if (!value || typeof value !== "object") return false;
  const env = value as Record<string, unknown>;
  return (
    typeof env.name === "string" &&
    typeof env.rpcUrl === "string" &&
    typeof env.networkPassphrase === "string"
  );
}

export function readStoredEnvironment(): SorobanEnvironment {
  if (typeof window === "undefined") return DEFAULT_ENVIRONMENT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ENVIRONMENT;
    const parsed = JSON.parse(raw);
    return isEnvironment(parsed) ? parsed : DEFAULT_ENVIRONMENT;
  } catch {
    return DEFAULT_ENVIRONMENT;
  }
}

function persistEnvironment(env: SorobanEnvironment) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(env));
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

interface SorobanContextValue {
  events: NormalizedSorobanEvent[];
  health: RpcHealth;
  poller: SorobanEventPoller | null;
  environment: SorobanEnvironment;
  setEnvironment: (env: SorobanEnvironment) => void;
}

const SorobanContext = createContext<SorobanContextValue>({
  events: [],
  health: { connected: false, lastCheck: 0, lastEventTimestamp: null, error: null },
  poller: null,
  environment: DEFAULT_ENVIRONMENT,
  setEnvironment: () => {},
});

export function useSoroban() {
  return useContext(SorobanContext);
}

interface SorobanProviderProps {
  children: ReactNode;
  rpcUrl?: string;
  contractId?: string;
  environment?: SorobanEnvironment;
}

export function SorobanProvider({
  children,
  rpcUrl,
  contractId,
  environment: environmentProp,
}: SorobanProviderProps) {
  const [environment, setEnvironmentState] = useState<SorobanEnvironment>(
    () => environmentProp ?? readStoredEnvironment(),
  );
  const [events, setEvents] = useState<NormalizedSorobanEvent[]>([]);
  const [health, setHealth] = useState<RpcHealth>({
    connected: false,
    lastCheck: 0,
    lastEventTimestamp: null,
    error: null,
  });

  const activeRpcUrl = rpcUrl ?? environment.rpcUrl;

  const poller = useMemo(
    () => createSorobanEventPoller(activeRpcUrl, contractId),
    [activeRpcUrl, contractId],
  );

  const setEnvironment = useCallback((env: SorobanEnvironment) => {
    setEnvironmentState(env);
    persistEnvironment(env);
  }, []);

  useEffect(() => {
    // Re-scope data whenever the poller is re-initialized for a new endpoint.
    setEvents([]);
    setHealth({ connected: false, lastCheck: 0, lastEventTimestamp: null, error: null });

    const unsubHealth = poller.onHealth(setHealth);

    const unsubEvents = poller.onEvents((newEvents) => {
      setEvents((prev) => {
        const combined = [...newEvents, ...prev];
        return combined.slice(0, 200);
      });
    });

    poller.start();

    return () => {
      poller.stop();
      unsubHealth();
      unsubEvents();
    };
  }, [poller]);

  const value = useMemo<SorobanContextValue>(
    () => ({
      events,
      health,
      poller,
      environment,
      setEnvironment,
    }),
    [events, health, poller, environment, setEnvironment],
  );

  return (
    <SorobanContext.Provider value={value}>{children}</SorobanContext.Provider>
  );
}
    const unsubEvents = poller.onEvents((newEvents) => {
      setStore((prev) => {
        const combined = [...newEvents, ...prev.events];
        return { ...prev, events: combined.slice(0, 200) };
      });
    });

    poller.start();

    return () => {
      poller.stop();
      unsubHealth();
      unsubEvents();
    };
  }, [store.poller]);

  const value = useMemo<SorobanContextValue>(
    () => ({ events, health, poller, environment, setEnvironment }),
    [events, health, poller, environment, setEnvironment]
  );

  return <SorobanContext.Provider value={value}>{children}</SorobanContext.Provider>;
  );

  return <SorobanContext.Provider value={value}>{children}</SorobanContext.Provider>;
}

export function useSorobanEvents() {
  return useSoroban().events;
}

export function useSorobanHealth() {
  return useSoroban().health;
}

export function useSorobanEnvironment() {
  const { environment, setEnvironment } = useSoroban();
  return { environment, setEnvironment };
}
