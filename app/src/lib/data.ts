import { useEffect, useRef, useState } from "react";
import {
  foldEvents,
  mergeChainCommits,
  type AgentInfo,
  type ChainCommit,
  type LedgerRow,
  type LogEvent,
  type WatchCard,
} from "./types";

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
  agents: AgentInfo[];
  updatedAt: Date | null;
  demo: boolean;
  connected: boolean;
}

const DEMO_AGENTS: AgentInfo[] = [
  {
    name: "provenn-wc-agent",
    pubkey: "Cr4NpDSDCxdry4zjq879iD21k5nLJKuUBt11LcadDpWB",
    totalCommits: 4,
    revealed: 3,
    brierBps: 16250,
  },
  { name: "steamchaser", pubkey: "9xQeWvG816bUx9EPjHmaT7wYfbYcNmp4qBB1EWCkVh6d", totalCommits: 7, revealed: 7, brierBps: 41300 },
  { name: "closing-line-carl", pubkey: "4Nd1mYbTgQpXzW8kFhLrJvC2sD5eA7uP6qRnB3tKmZa9", totalCommits: 2, revealed: 1, brierBps: 14100 },
];

export function useDashboard(): DashboardState {
  const [state, setState] = useState<DashboardState>({
    rows: [],
    watch: [],
    agent: null,
    agents: [],
    updatedAt: null,
    demo: isDemo(),
    connected: false,
  });
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    const demo = isDemo();

    async function tick() {
      const logUrl = demo ? "/demo-log.json" : `${API_BASE}/api/log`;
      const [events, commits, agents] = await Promise.all([
        fetchJson<LogEvent[]>(logUrl),
        demo ? Promise.resolve<ChainCommit[] | null>([]) : fetchJson<ChainCommit[]>(`${API_BASE}/api/commits`),
        demo ? Promise.resolve<AgentInfo[] | null>(DEMO_AGENTS) : fetchJson<AgentInfo[]>(`${API_BASE}/api/agents`),
      ]);
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
        const { rows, watch, fixtureNames } = foldEvents(events);
        const merged = mergeChainCommits(rows, commits ?? [], fixtureNames);
        if (demo) for (const w of watch) synthesizeHistory(w);
        setState({
          rows: merged,
          watch,
          agent,
          agents: agents ?? [],
          updatedAt: new Date(),
          demo,
          connected: true,
        });
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

/** Deterministic PRNG so demo charts are stable across polls. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Demo only: back-fill a plausible 60-minute random walk ending at current probs. */
function synthesizeHistory(w: { matchId: string; probs?: number[]; history: { t: number; probs: number[] }[] }): void {
  if (!w.probs || w.probs.length !== 3 || w.history.length >= 5) return;
  const rand = mulberry32([...w.matchId].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const points = 40;
  const end = Date.now();
  let probs = [...w.probs];
  const series: { t: number; probs: number[] }[] = [{ t: end, probs: [...probs] }];
  for (let i = 1; i < points; i++) {
    probs = probs.map((p) => Math.max(0.03, p + (rand() - 0.5) * 0.02));
    const sum = probs.reduce((a, b) => a + b, 0);
    probs = probs.map((p) => p / sum);
    series.unshift({ t: end - i * 90_000, probs: [...probs] });
  }
  w.history = series;
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
