/**
 * Plain-language layer — turns the protocol's technical facts (Brier basis
 * points, commit/reveal phases) into words a non-developer reads at a glance.
 * The technical numbers stay one toggle away; nothing here hides the proof.
 */
import { useEffect, useState } from "react";
import type { AgentInfo, Phase } from "./types";

export type ViewMode = "simple" | "technical";
const STORE_KEY = "provenn.view";

/** Site-wide Simple/Technical preference, remembered across visits. */
export function useViewMode(): [ViewMode, () => void] {
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      return (localStorage.getItem(STORE_KEY) as ViewMode | null) ?? "simple";
    } catch {
      return "simple";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, mode);
    } catch {
      /* private mode — preference just won't persist */
    }
  }, [mode]);
  return [mode, () => setMode((m) => (m === "simple" ? "technical" : "simple"))];
}

export type VerdictTone = "sharp" | "solid" | "fair" | "shaky" | "none";
export interface Verdict {
  label: string;
  blurb: string;
  tone: VerdictTone;
}

/**
 * Mean Brier score as a plain number (0 = perfect, 1 = maximally wrong), or
 * null when the agent has nothing scored yet. Matches the leaderboard's
 * cumulative-over-total-commits definition so the two never disagree.
 */
export function meanBrierNum(a: AgentInfo | null | undefined): number | null {
  if (!a?.totalCommits || a.brierBps === undefined) return null;
  return a.brierBps / a.totalCommits / 10000;
}

/** A one-word read on an agent's record, derived from its mean Brier. */
export function verdict(a: AgentInfo | null | undefined): Verdict {
  const m = meanBrierNum(a);
  if (m === null) return { label: "Unproven", blurb: "no scored predictions yet", tone: "none" };
  if (m < 0.1) return { label: "Sharp", blurb: "calls games right, with conviction", tone: "sharp" };
  if (m < 0.2) return { label: "Solid", blurb: "right more often than not", tone: "solid" };
  if (m < 0.35) return { label: "Fair", blurb: "a mixed record so far", tone: "fair" };
  return { label: "Shaky", blurb: "wrong more than it's right", tone: "shaky" };
}

/** Plain-language name + tone for a commit's lifecycle phase. */
export function phasePlain(phase: Phase): { label: string; tone: string } {
  switch (phase) {
    case "committed":
      return { label: "Prediction locked", tone: "committed" };
    case "revealed":
      return { label: "Opened & verified", tone: "revealed" };
    case "settled":
      return { label: "Scored", tone: "settled" };
    case "unrevealed-loss":
      return { label: "Never opened — counts as a loss", tone: "loss" };
  }
}

/** Was a single scored call a good one? Brier below 0.25 beats a coin-flip guess. */
export function callResult(
  brierBps: number | undefined,
  phase: Phase,
): { label: string; tone: "good" | "off" | "loss" | "pending" } {
  if (phase === "unrevealed-loss") return { label: "Hidden — counted as a loss", tone: "loss" };
  if (brierBps === undefined || phase !== "settled") return { label: "Awaiting result", tone: "pending" };
  return brierBps <= 2500
    ? { label: "Good call", tone: "good" }
    : { label: "Missed", tone: "off" };
}
