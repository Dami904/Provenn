import { useMemo, useState } from "react";
import { ProbChart } from "../components/ProbChart";
import { Ticker } from "../components/Ticker";
import { explorerTx, meanBrier, shortHash, type DashboardState } from "../lib/data";
import { callResult, phasePlain, useViewMode, verdict, type ViewMode } from "../lib/plain";
import { onLinkClick } from "../lib/router";
import { OUTCOME_LABELS, type AgentInfo, type LedgerRow, type Phase } from "../lib/types";
import { gotoAgent, ModeToggle } from "./AgentProfile";

function CopyChip({ value, display }: { value: string; display?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={`chip${copied ? " copied" : ""}`}
      title={value}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "copied" : (display ?? shortHash(value))}
    </button>
  );
}

function PhaseBadge({ phase, mode }: { phase: Phase; mode: ViewMode }) {
  if (mode === "simple") {
    const { label, tone } = phasePlain(phase);
    return <span className={`badge ${tone === "loss" ? "loss" : tone === "settled" ? "settled" : tone === "committed" ? "committed" : ""}`}>{label}</span>;
  }
  if (phase === "unrevealed-loss") return <span className="badge loss">UNREVEALED — SCORED AS LOSS</span>;
  if (phase === "settled") return <span className="badge settled">SETTLED</span>;
  if (phase === "revealed") return <span className="badge">REVEALED</span>;
  return <span className="badge committed">COMMITTED</span>;
}

function TxLink({ sig, label }: { sig?: string; label: string }) {
  if (!sig) return null;
  return (
    <a href={explorerTx(sig)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
      {label}
    </a>
  );
}

function RowDetail({ row }: { row: LedgerRow }) {
  return (
    <tr className="detail">
      <td colSpan={7}>
        <div className="detail-inner">
          <dl className="detail-grid">
            <dt>Match ID</dt>
            <dd>{row.matchId}</dd>
            {row.prediction !== undefined && (
              <>
                <dt>Prediction</dt>
                <dd>{JSON.stringify(row.prediction)}</dd>
              </>
            )}
            {row.nonce && (
              <>
                <dt>Nonce</dt>
                <dd>{row.nonce}</dd>
              </>
            )}
            {row.hash && (
              <>
                <dt>Commit hash</dt>
                <dd>{row.hash}</dd>
              </>
            )}
            {row.commitTx && (
              <>
                <dt>Commit tx</dt>
                <dd>
                  <TxLink sig={row.commitTx} label={row.commitTx} />
                </dd>
              </>
            )}
            {row.revealTx && (
              <>
                <dt>Reveal tx</dt>
                <dd>
                  <TxLink sig={row.revealTx} label={row.revealTx} />
                </dd>
              </>
            )}
            {row.settleTx && (
              <>
                <dt>Settle tx</dt>
                <dd>
                  <TxLink sig={row.settleTx} label={row.settleTx} />
                </dd>
              </>
            )}
          </dl>
          {row.hash && (
            <div className="equation">
              sha256(prediction ‖ nonce) = {row.hash}{" "}
              {row.revealTx || row.phase === "settled" ? (
                <span className="ok">✓ verified on reveal</span>
              ) : (
                <span>· awaiting reveal</span>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

type Filter = "all" | "open" | "settled";

function matchesFilter(row: LedgerRow, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "open") return row.phase === "committed" || row.phase === "revealed";
  return row.phase === "settled" || row.phase === "unrevealed-loss";
}

export function Dashboard({ state }: { state: DashboardState }) {
  const { rows, watch, agent, agents, updatedAt, demo, connected } = state;
  const [mode, toggleMode] = useViewMode();
  const [filter, setFilter] = useState<Filter>("all");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [chartMatch, setChartMatch] = useState<string | null>(null);

  const visible = useMemo(() => rows.filter((r) => matchesFilter(r, filter)), [rows, filter]);
  const chartCard = watch.find((w) => w.matchId === chartMatch);
  const v = verdict(agent);

  return (
    <div className="wrap page">
      <div className="topbar">
        <h2 className="wordmark">
          <a href="/" onClick={onLinkClick} className="home-link">
            ← PROVENN
          </a>
          <small>agent dashboard</small>
        </h2>
        <div className="agent-id">
          {agent?.name && <span>{agent.name}</span>}
          {mode === "technical" && agent?.pubkey && <CopyChip value={agent.pubkey} />}
          {mode === "technical" && agent?.registeredSlot !== undefined && (
            <span>registered @ slot {agent.registeredSlot}</span>
          )}
          {agent && (
            <span>
              {agent.totalCommits ?? 0} predictions · {agent.revealed ?? 0} opened
            </span>
          )}
        </div>
        <div className={`brier tone-${v.tone}`}>
          {mode === "simple" ? (
            <>
              <div className={`value verdict tone-${v.tone}`}>{v.label}</div>
              <div className="label">{v.blurb}</div>
            </>
          ) : (
            <>
              <div className="value mono">{meanBrier(agent)}</div>
              <div className="label">mean Brier — lower is better</div>
            </>
          )}
        </div>
        <ModeToggle mode={mode} toggleMode={toggleMode} />
      </div>

      {mode === "simple" && (
        <p className="what-strip">
          <strong>What you're looking at:</strong> an AI agent that predicts World Cup results, with
          every call locked onto the blockchain before kickoff so it can't be faked. Green means a
          good call; a hidden call is counted as a loss. Flip to <em>Technical</em> for the raw proof.
        </p>
      )}

      <Ticker watch={watch} />

      <div className="status-line">
        <span className={`dot${connected ? " ok" : ""}`} />
        {demo
          ? "Demo data — remove ?demo from the URL to connect to the live agent."
          : connected
            ? `Live · updated ${updatedAt ? updatedAt.toLocaleTimeString() : ""}`
            : "Waiting for the agent API…"}
      </div>

      <section className="rise" style={{ "--i": 0 } as React.CSSProperties}>
        <h2 className="section-title">Live watch</h2>
        {watch.length === 0 ? (
          <div className="empty">Watching for World Cup fixtures…</div>
        ) : (
          <>
            <div className="watch-row">
              {watch.map((w, i) => (
                <article
                  className={`watch-card rise${chartMatch === w.matchId ? " selected" : ""}`}
                  style={{ "--i": i } as React.CSSProperties}
                  key={w.matchId}
                  onClick={() => setChartMatch(chartMatch === w.matchId ? null : w.matchId)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setChartMatch(chartMatch === w.matchId ? null : w.matchId);
                  }}
                  aria-expanded={chartMatch === w.matchId}
                >
                  <h3>{w.fixture}</h3>
                  {w.probs?.length === 3 &&
                    w.probs.map((p, j) => (
                      <div className="prob" key={j}>
                        <span>{OUTCOME_LABELS[j]}</span>
                        <span className="bar">
                          <i style={{ width: `${Math.round(p * 100)}%` }} />
                        </span>
                        <span className="mono">{(p * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  <div className="watch-meta">
                    <span>drift {w.driftPct !== undefined ? `${w.driftPct.toFixed(2)}%` : "—"}</span>
                    <span>{w.integrityOk === false ? `gated: ${w.reason ?? "bad feed"}` : "view chart ↓"}</span>
                  </div>
                </article>
              ))}
            </div>
            {chartCard && (
              <div className="chart-panel rise">
                <div className="chart-title">
                  <b>{chartCard.fixture}</b> — implied probability, live
                </div>
                <ProbChart history={chartCard.history} />
              </div>
            )}
          </>
        )}
      </section>

      <section className="rise" style={{ "--i": 1 } as React.CSSProperties}>
        <h2 className="section-title">{mode === "simple" ? "Its predictions" : "Commit ledger"}</h2>
        <div className="tabs" role="tablist">
          {(["all", "open", "settled"] as const).map((f) => (
            <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "open" ? "Open" : "Settled"}
            </button>
          ))}
        </div>
        {visible.length === 0 ? (
          <div className="empty">
            No predictions yet. Every call lands here before the match ends — or scores as a loss.
          </div>
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                {mode === "simple" ? (
                  <tr>
                    <th>Fixture</th>
                    <th>Pick</th>
                    <th>Confidence</th>
                    <th>Status</th>
                    <th>Result</th>
                  </tr>
                ) : (
                  <tr>
                    <th>Time</th>
                    <th>Fixture</th>
                    <th>Signal</th>
                    <th>Confidence</th>
                    <th>Phase</th>
                    <th>Proof</th>
                    <th>Brier</th>
                  </tr>
                )}
              </thead>
              <tbody key={filter}>
                {visible.map((row, i) => (
                  <LedgerRowView
                    key={row.matchId}
                    row={row}
                    index={i}
                    mode={mode}
                    open={openRow === row.matchId}
                    onToggle={() => setOpenRow(openRow === row.matchId ? null : row.matchId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rise" style={{ "--i": 2 } as React.CSSProperties}>
        <h2 className="section-title">Leaderboard</h2>
        <Leaderboard agents={agents.length ? agents : agent ? [agent] : []} self={agent?.pubkey} mode={mode} />
      </section>
    </div>
  );
}

function Leaderboard({ agents, self, mode }: { agents: AgentInfo[]; self?: string; mode: ViewMode }) {
  const ranked = useMemo(
    () =>
      [...agents].sort((a, b) => {
        const ma = a.totalCommits ? (a.brierBps ?? 0) / a.totalCommits : Infinity;
        const mb = b.totalCommits ? (b.brierBps ?? 0) / b.totalCommits : Infinity;
        return ma - mb;
      }),
    [agents],
  );

  if (ranked.length === 0) {
    return <div className="empty">The registry is open — any agent can register and be scored here.</div>;
  }
  return (
    <>
      <div className="ledger-scroll">
        <table className="ledger compact">
          <thead>
            {mode === "simple" ? (
              <tr>
                <th>#</th>
                <th>Agent</th>
                <th>Predictions</th>
                <th>Record</th>
              </tr>
            ) : (
              <tr>
                <th>#</th>
                <th>Agent</th>
                <th>Commits</th>
                <th>Revealed</th>
                <th>Mean Brier</th>
              </tr>
            )}
          </thead>
          <tbody>
            {ranked.map((a, i) => {
              const v = verdict(a);
              return (
                <tr
                  key={a.pubkey ?? i}
                  className={`rise clickable${i === 0 ? " lead" : ""}${self && a.pubkey === self ? " self" : ""}`}
                  style={{ "--i": i } as React.CSSProperties}
                  onClick={() => gotoAgent(a)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") gotoAgent(a);
                  }}
                  title="View this agent's full record"
                >
                  <td className="mono">{i === 0 ? <span className="rank-one">1</span> : i + 1}</td>
                  <td>
                    <span className="agent-name-link">{a.name ?? "agent"}</span>
                    {mode === "technical" && a.pubkey && <CopyChip value={a.pubkey} />}
                    {self && a.pubkey === self && <span className="badge">THIS AGENT</span>}
                  </td>
                  {mode === "simple" ? (
                    <>
                      <td className="mono">{a.totalCommits ?? 0}</td>
                      <td>
                        <span className={`verdict-pill tone-${v.tone}`}>{v.label}</span>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="mono">{a.totalCommits ?? 0}</td>
                      <td className="mono">
                        {a.totalCommits ? `${Math.round(((a.revealed ?? 0) / a.totalCommits) * 100)}%` : "—"}
                      </td>
                      <td className="mono">{meanBrier(a)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        {mode === "simple"
          ? "Best record first. Tap any agent to see its full history. An agent that hides a prediction is scored as if it lost — so what you see here is the honest picture."
          : "Ranked by mean Brier over each agent's complete on-chain record — unrevealed commits score the maximum 1.000 loss, so hiding a bad call is worse than revealing it. Recompute any score yourself from the raw accounts."}
      </p>
    </>
  );
}

function LedgerRowView({
  row,
  index,
  mode,
  open,
  onToggle,
}: {
  row: LedgerRow;
  index: number;
  mode: ViewMode;
  open: boolean;
  onToggle: () => void;
}) {
  const rowProps = {
    className: "row rise",
    style: { "--i": index } as React.CSSProperties,
    onClick: onToggle,
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggle();
      }
    },
    "aria-expanded": open,
  };

  if (mode === "simple") {
    const res = callResult(row.brierBps, row.phase);
    return (
      <>
        <tr {...rowProps}>
          <td>{row.fixture}</td>
          <td>{row.outcome !== undefined ? OUTCOME_LABELS[row.outcome] : "—"}</td>
          <td className="mono">
            {row.confidenceBps !== undefined ? `${(row.confidenceBps / 100).toFixed(0)}% sure` : "—"}
          </td>
          <td>
            <PhaseBadge phase={row.phase} mode={mode} />
          </td>
          <td>
            <span className={`result-pill tone-${res.tone}`}>{res.label}</span>
          </td>
        </tr>
        {open && <RowDetail row={row} />}
      </>
    );
  }

  return (
    <>
      <tr {...rowProps}>
        <td className="mono">{row.time ?? "—"}</td>
        <td>{row.fixture}</td>
        <td>
          {row.outcome !== undefined ? OUTCOME_LABELS[row.outcome] : "—"}
          {row.driftPct !== undefined && (
            <span className="mono" style={{ color: "var(--muted)" }}>
              {" "}
              {row.driftPct > 0 ? "+" : ""}
              {row.driftPct.toFixed(2)}%
            </span>
          )}
        </td>
        <td className="mono">
          {row.confidenceBps !== undefined ? `${(row.confidenceBps / 100).toFixed(1)}%` : "—"}
        </td>
        <td>
          <PhaseBadge phase={row.phase} mode={mode} />
        </td>
        <td>
          {row.hash && <CopyChip value={row.hash} />} <TxLink sig={row.commitTx} label="commit" />{" "}
          <TxLink sig={row.revealTx} label="reveal" /> <TxLink sig={row.settleTx} label="settle" />
        </td>
        <td className="mono">{row.brierBps !== undefined ? (row.brierBps / 10000).toFixed(3) : "—"}</td>
      </tr>
      {open && <RowDetail row={row} />}
    </>
  );
}
