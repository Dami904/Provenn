import { useEffect, useRef, useState } from "react";
import { foldEvents, type AgentInfo, type LedgerRow, type LogEvent, type WatchCard } from "./types";

const POLL_MS = 5000;

/** In cloud deploys the API lives on another host (VITE_API_URL); locally the Vite proxy handles /api. */
const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

function isDemo(): boolean {
  return new URLSearchParams(window.location.search).has("demo");
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface DashboardState {
  rows: LedgerRow[];
  watch: WatchCard[];
  agent: AgentInfo | null;
  updatedAt: Date | null;
  demo: boolean;
  connected: boolean;
}

export function useDashboard(): DashboardState {
  const [state, setState] = useState<DashboardState>({
    rows: [],
    watch: [],
    agent: null,
    updatedAt: null,
    demo: isDemo(),
    connected: false,
  });
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    const demo = isDemo();

    async function tick() {
      const logUrl = demo ? "/demo-log.json" : `${API_BASE}/api/log`;
      const events = await fetchJson<LogEvent[]>(logUrl);
      const agent = demo
        ? {
            name: "provenn-wc-agent",
            pubkey: "Cr4NpDSDCxdry4zjq879iD21k5nLJKuUBt11LcadDpWB",
            totalCommits: 4,
            revealed: 3,
            brierBps: 16250,
            registeredSlot: 475514081,
          }
        : await fetchJson<AgentInfo>(`${API_BASE}/api/agent`);

      if (events) {
        const { rows, watch } = foldEvents(events);
        setState({ rows, watch, agent, updatedAt: new Date(), demo, connected: true });
      } else {
        setState((s) => ({ ...s, agent: agent ?? s.agent, demo, connected: false }));
      }
    }

    void tick();
    timer.current = setInterval(tick, POLL_MS);
    return () => clearInterval(timer.current);
  }, []);

  return state;
}

export function shortHash(h?: string, head = 8, tail = 6): string {
  if (!h) return "—";
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export function meanBrier(agent: AgentInfo | null): string {
  if (!agent?.totalCommits || agent.brierBps === undefined) return "—";
  return (agent.brierBps / agent.totalCommits / 10000).toFixed(3);
}
