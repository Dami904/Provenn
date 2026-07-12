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
  /** Raw on-chain commit ledger (every agent) — powers per-agent profiles. */
  commits: ChainCommit[];
  updatedAt: Date | null;
  demo: boolean;
  connected: boolean;
}

// Demo values are tuned to show the full verdict range (Sharp / Solid / Fair)
// so the sample view demonstrates what a non-developer would read.
const DEMO_AGENTS: AgentInfo[] = [
  {
    name: "provenn-wc-agent",
    pubkey: "Cr4NpDSDCxdry4zjq879iD21k5nLJKuUBt11LcadDpWB",
    totalCommits: 6,
    revealed: 6,
    brierBps: 480, // mean 0.080 -> Sharp
  },
  { name: "steamchaser", pubkey: "9xQeWvG816bUx9EPjHmaT7wYfbYcNmp4qBB1EWCkVh6d", totalCommits: 8, revealed: 7, brierBps: 1360 }, // 0.170 -> Solid
  { name: "closing-line-carl", pubkey: "4Nd1mYbTgQpXzW8kFhLrJvC2sD5eA7uP6qRnB3tKmZa9", totalCommits: 5, revealed: 4, brierBps: 1450 }, // 0.290 -> Fair
];

// A handful of demo calls for the leader, so a clicked profile in the sample
// view shows a real per-agent history instead of an empty state.
const LEADER_PUBKEY = "Cr4NpDSDCxdry4zjq879iD21k5nLJKuUBt11LcadDpWB";
const DEMO_COMMITS: ChainCommit[] = [
  { matchId: "17588341", agent: LEADER_PUBKEY, hash: "b71c9a4e0f2d8837a1", slot: 475600120, ts: Date.now() - 3 * 3600_000, revealed: true, settled: true, outcome: 0, confidenceBps: 6600, brierBps: 1156 },
  { matchId: "17588338", agent: LEADER_PUBKEY, hash: "3f0a1d92c4e75b60aa", slot: 475598004, ts: Date.now() - 26 * 3600_000, revealed: true, settled: true, outcome: 2, confidenceBps: 5800, brierBps: 1764 },
  { matchId: "17588332", agent: LEADER_PUBKEY, hash: "9c2e7740ab13f5d8e1", slot: 475590210, ts: Date.now() - 50 * 3600_000, revealed: true, settled: true, outcome: 1, confidenceBps: 4200, brierBps: 3364 },
  { matchId: "17588327", agent: LEADER_PUBKEY, hash: "1a6b33c9df08e24270", slot: 475581999, ts: Date.now() - 74 * 3600_000, revealed: true, settled: true, outcome: 0, confidenceBps: 7100, brierBps: 841 },
  { matchId: "17588319", agent: LEADER_PUBKEY, hash: "e480fa1c25937bd6c0", slot: 475572140, ts: Date.now() - 98 * 3600_000, revealed: false, settled: false, confidenceBps: undefined },
];

/**
 * Track the ?demo flag reactively. The dashboard hook lives above the router
 * and never unmounts, so it must re-read demo-ness on client-side navigation
 * (popstate) — otherwise switching demo⇄live without a full reload keeps
 * serving the old mode's data.
 */
function useIsDemo(): boolean {
  const [demo, setDemo] = useState(isDemo);
  useEffect(() => {
    const sync = () => setDemo(isDemo());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  return demo;
}

export function useDashboard(): DashboardState {
  const demo = useIsDemo();
  const [state, setState] = useState<DashboardState>({
    rows: [],
    watch: [],
    agent: null,
    agents: [],
    commits: [],
    updatedAt: null,
    demo,
    connected: false,
  });
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    // Mode just changed (or first mount): wipe the previous mode's data so a
    // stale demo agent can never masquerade as live while the first fetch runs.
    setState((s) => ({
      ...s,
      rows: [],
      watch: [],
      agent: null,
      agents: [],
      commits: [],
      demo,
      connected: false,
    }));

    async function tick() {
      const logUrl = demo ? "/demo-log.json" : `${API_BASE}/api/log`;
      const [events, commits, agents] = await Promise.all([
        fetchJson<LogEvent[]>(logUrl),
        demo ? Promise.resolve<ChainCommit[] | null>(DEMO_COMMITS) : fetchJson<ChainCommit[]>(`${API_BASE}/api/commits`),
        demo ? Promise.resolve<AgentInfo[] | null>(DEMO_AGENTS) : fetchJson<AgentInfo[]>(`${API_BASE}/api/agents`),
      ]);
      const agent = demo
        ? {
            name: "provenn-wc-agent",
            pubkey: "Cr4NpDSDCxdry4zjq879iD21k5nLJKuUBt11LcadDpWB",
            totalCommits: 6,
            revealed: 6,
            brierBps: 480,
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
          commits: commits ?? [],
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
  }, [demo]);

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

export function explorerAddr(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

export function meanBrier(agent: AgentInfo | null): string {
  if (!agent?.totalCommits || agent.brierBps === undefined) return "—";
  return (agent.brierBps / agent.totalCommits / 10000).toFixed(3);
}
