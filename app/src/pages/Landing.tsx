import { useEffect, useRef, useState } from "react";
import { Ticker } from "../components/Ticker";
import { meanBrier, type DashboardState } from "../lib/data";
import { onLinkClick } from "../lib/router";

/** Count-up for headline numbers; renders instantly under reduced motion. */
function useCountUp(target: number, ms = 900): number {
  const [value, setValue] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setValue(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return value;
}

function Stat({ value, label, decimals = 0 }: { value: number; label: string; decimals?: number }) {
  const v = useCountUp(value);
  return (
    <div className="stat">
      <div className="stat-value mono">{v.toFixed(decimals)}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Landing({ state }: { state: DashboardState }) {
  const { agent, watch } = state;
  const revealedPct = agent?.totalCommits ? ((agent.revealed ?? 0) / agent.totalCommits) * 100 : 0;

  return (
    <div className="wrap page">
      <nav className="landing-nav rise" style={{ "--i": 0 } as React.CSSProperties}>
        <span className="wordmark">PROVENN</span>
        <div className="nav-links">
          <a href="https://github.com/Dami904/Provenn" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a
            href="https://explorer.solana.com/address/Ayfm8HcwaMTXFVxc3zTvXBcLAu57tHc4gVKMgE1wSpr2?cluster=devnet"
            target="_blank"
            rel="noreferrer"
          >
            Program
          </a>
          <a href="/guide.html" target="_blank" rel="noreferrer">
            Guide
          </a>
          <a href="/dashboard" onClick={onLinkClick}>
            Dashboard
          </a>
        </div>
      </nav>

      <header className="hero landing-hero">
        <h1 className="rise" style={{ "--i": 1 } as React.CSSProperties}>
          PROVENN
        </h1>
        <p className="tagline rise" style={{ "--i": 2 } as React.CSSProperties}>
          Trading agents whose track records can't be faked.
        </p>
        <p className="lede rise" style={{ "--i": 3 } as React.CSSProperties}>
          Every prediction is hash-committed to Solana <em>before</em> the outcome exists and must be
          revealed by settlement — an unrevealed commit automatically scores as a maximum loss. No
          deleted calls, no cherry-picking, no rewritten history. The agent trades live World Cup
          odds; anyone can recompute its record from the chain.
        </p>
        <div className="cta-row rise" style={{ "--i": 4 } as React.CSSProperties}>
          <a href="/dashboard" onClick={onLinkClick} className="cta">
            Open the dashboard →
          </a>
          <a href="/dashboard?demo" className="cta secondary">
            View demo data
          </a>
        </div>
      </header>

      <div className="rise" style={{ "--i": 5 } as React.CSSProperties}>
        <Ticker watch={watch} />
      </div>

      <section className="rise" style={{ "--i": 6 } as React.CSSProperties}>
        <ol className="steps">
          <li>
            <b>Commit</b> — a deterministic signal fires on live odds drift; its hash lands on-chain
            before the match decides anything.
          </li>
          <li>
            <b>Reveal</b> — after the match, the plaintext prediction is published and verified
            against the hash.
          </li>
          <li>
            <b>Score</b> — outcomes update an on-chain Brier score. Silence counts as a loss.
          </li>
        </ol>
      </section>

      <section className="stats-strip rise" style={{ "--i": 7 } as React.CSSProperties}>
        <Stat value={agent?.totalCommits ?? 0} label="commits on-chain" />
        <Stat value={revealedPct} label="% revealed" />
        <Stat value={agent ? Number(meanBrier(agent)) || 0 : 0} label="mean Brier (lower is better)" decimals={3} />
        <Stat value={watch.length} label="fixtures watched live" />
      </section>

      <footer className="landing-foot rise" style={{ "--i": 8 } as React.CSSProperties}>
        Built for the TxODDS World Cup Hackathon · Trading Tools &amp; Agents · Solana devnet program{" "}
        <span className="mono">Ayfm…Spr2</span>
      </footer>
    </div>
  );
}
