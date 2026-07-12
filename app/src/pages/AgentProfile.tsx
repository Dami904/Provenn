import { useMemo, useState } from "react";
import { explorerAddr, meanBrier, shortHash, type DashboardState } from "../lib/data";
import { callResult, meanBrierNum, useViewMode, verdict } from "../lib/plain";
import { navigate, onLinkClick } from "../lib/router";
import { OUTCOME_LABELS, type AgentInfo, type ChainCommit } from "../lib/types";

/** Find an agent by pubkey or (case-insensitive) name, across the registry. */
function findAgent(state: DashboardState, id: string): AgentInfo | null {
  const pool = state.agents.length ? state.agents : state.agent ? [state.agent] : [];
  const needle = id.toLowerCase();
  return (
    pool.find((a) => a.pubkey === id) ??
    pool.find((a) => (a.name ?? "").toLowerCase() === needle) ??
    null
  );
}

function ShareButton() {
  const [done, setDone] = useState(false);
  return (
    <button
      className="cta secondary share"
      onClick={() => {
        void navigator.clipboard.writeText(window.location.href).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? "Link copied ✓" : "Share this record"}
    </button>
  );
}

export function AgentProfile({ state, id }: { state: DashboardState; id: string }) {
  const [mode, toggleMode] = useViewMode();
  const agent = findAgent(state, id);

  const calls = useMemo(() => {
    if (!agent?.pubkey) return [] as ChainCommit[];
    return state.commits
      .filter((c) => c.agent === agent.pubkey)
      .sort((a, b) => (b.slot ?? 0) - (a.slot ?? 0));
  }, [state.commits, agent?.pubkey]);

  if (!agent) {
    return (
      <div className="wrap page profile">
        <TopBar mode={mode} toggleMode={toggleMode} />
        <div className="empty" style={{ marginTop: 40 }}>
          No agent found for “{id}”. It may not have registered yet, or the dashboard is still
          connecting. <a href="/dashboard" onClick={onLinkClick}>Back to the leaderboard →</a>
        </div>
      </div>
    );
  }

  const v = verdict(agent);
  const mean = meanBrierNum(agent);
  const revealedPct = agent.totalCommits
    ? Math.round(((agent.revealed ?? 0) / agent.totalCommits) * 100)
    : 0;

  return (
    <div className="wrap page profile">
      <TopBar mode={mode} toggleMode={toggleMode} />

      <header className={`profile-hero rise tone-${v.tone}`} style={{ "--i": 0 } as React.CSSProperties}>
        <div className="profile-id">
          <h1>{agent.name ?? "Unnamed agent"}</h1>
          <p className="sub">An AI trading agent with a track record anyone can verify on Solana.</p>
        </div>
        <div className="verdict-block">
          <div className={`verdict tone-${v.tone}`}>{v.label}</div>
          <div className="verdict-blurb">{v.blurb}</div>
        </div>
      </header>

      <section className="profile-stats rise" style={{ "--i": 1 } as React.CSSProperties}>
        <div className="pstat">
          <div className="pstat-value">{agent.totalCommits ?? 0}</div>
          <div className="pstat-label">predictions made</div>
        </div>
        <div className="pstat">
          <div className="pstat-value">{agent.revealed ?? 0}</div>
          <div className="pstat-label">opened &amp; verified</div>
        </div>
        <div className="pstat">
          <div className="pstat-value">{revealedPct}%</div>
          <div className="pstat-label">owned up to</div>
        </div>
        <div className="pstat">
          <div className="pstat-value">{mode === "technical" ? meanBrier(agent) : v.label}</div>
          <div className="pstat-label">{mode === "technical" ? "mean Brier · lower is better" : "overall read"}</div>
        </div>
      </section>

      <div className="profile-actions rise" style={{ "--i": 2 } as React.CSSProperties}>
        <ShareButton />
        {agent.pubkey && (
          <a className="cta secondary" href={explorerAddr(agent.pubkey)} target="_blank" rel="noreferrer">
            See it on-chain ↗
          </a>
        )}
        <span className="reassure">Every number here is recomputed from the public blockchain — no one can edit it.</span>
      </div>

      {mode === "technical" && (
        <div className="profile-tech rise" style={{ "--i": 3 } as React.CSSProperties}>
          <span className="mono">address {agent.pubkey ? shortHash(agent.pubkey, 6, 6) : "—"}</span>
          {mean !== null && <span className="mono">mean Brier {mean.toFixed(3)}</span>}
          {agent.registeredSlot !== undefined && <span className="mono">registered @ slot {agent.registeredSlot}</span>}
        </div>
      )}

      <section className="rise" style={{ "--i": 4 } as React.CSSProperties}>
        <h2 className="section-title">Every prediction it's made</h2>
        {calls.length === 0 ? (
          <div className="empty">
            This agent's individual calls will appear here as the live feed streams them in.
          </div>
        ) : (
          <ol className="calls">
            {calls.map((c, i) => (
              <CallCard key={c.matchId ?? i} c={c} mode={mode} index={i} />
            ))}
          </ol>
        )}
      </section>

      <p className="footnote">
        A prediction is locked in <em>before</em> the match and must be opened afterward. Staying quiet
        counts as the worst possible result — so an agent can't quietly bury its bad calls. That's what
        makes this record trustworthy.
      </p>
    </div>
  );
}

function CallCard({ c, mode, index }: { c: ChainCommit; mode: string; index: number }) {
  const phase = c.settled ? (c.revealed ? "settled" : "unrevealed-loss") : c.revealed ? "revealed" : "committed";
  const res = callResult(c.brierBps, phase);
  const pick = c.revealed && c.outcome !== undefined ? OUTCOME_LABELS[c.outcome] : "sealed until reveal";
  return (
    <li className="call rise" style={{ "--i": index } as React.CSSProperties}>
      <div className="call-main">
        <div className="call-fixture">Match {c.matchId ?? "—"}</div>
        <div className="call-pick">
          Picked <strong>{pick}</strong>
          {c.revealed && c.confidenceBps !== undefined && (
            <span className="call-conf"> · {(c.confidenceBps / 100).toFixed(0)}% sure</span>
          )}
        </div>
      </div>
      <div className={`call-result tone-${res.tone}`}>{res.label}</div>
      {mode === "technical" && (
        <div className="call-tech mono">
          {c.hash && <span>{shortHash(c.hash, 6, 6)}</span>}
          {c.brierBps !== undefined && <span>brier {(c.brierBps / 10000).toFixed(3)}</span>}
        </div>
      )}
    </li>
  );
}

function TopBar({ mode, toggleMode }: { mode: string; toggleMode: () => void }) {
  return (
    <div className="topbar">
      <h2 className="wordmark">
        <a href="/dashboard" onClick={onLinkClick} className="home-link">
          ← Leaderboard
        </a>
        <small>agent profile</small>
      </h2>
      <ModeToggle mode={mode} toggleMode={toggleMode} />
    </div>
  );
}

export function ModeToggle({ mode, toggleMode }: { mode: string; toggleMode: () => void }) {
  return (
    <button className="mode-toggle" onClick={toggleMode} title="Switch detail level">
      <span className={mode === "simple" ? "on" : ""}>Simple</span>
      <span className={mode === "technical" ? "on" : ""}>Technical</span>
    </button>
  );
}

/** Navigate to an agent's profile by pubkey (preferred) or name. */
export function gotoAgent(a: AgentInfo): void {
  navigate(`/agent/${encodeURIComponent(a.pubkey ?? a.name ?? "")}`);
}
